package app.tsmobile.gateway;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.github.manevolent.ts3j.command.SingleCommand;
import com.github.manevolent.ts3j.command.parameter.CommandParameter;
import com.github.manevolent.ts3j.enums.CodecType;
import com.github.manevolent.ts3j.event.*;
import com.github.manevolent.ts3j.identity.LocalIdentity;
import com.github.manevolent.ts3j.protocol.ProtocolRole;
import com.github.manevolent.ts3j.protocol.packet.PacketBody0Voice;
import com.github.manevolent.ts3j.protocol.socket.client.LocalTeamspeakClientSocket;
import io.github.jaredmdobson.concentus.OpusDecoder;
import io.github.jaredmdobson.concentus.OpusException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayInputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Uma conexao TeamSpeak por WebSocket do navegador.
 *
 * O gateway fala o protocolo UDP criptografado do TeamSpeak (via ts3j) e expoe
 * ao navegador um protocolo simples em JSON + frames binarios de audio.
 * Para o compartilhamento de tela do TS6 o gateway apenas repassa a sinalizacao
 * (SDP/ICE): o video vai direto do servidor/streamer para o RTCPeerConnection do navegador.
 */
final class TsSession {
    private static final Logger log = LoggerFactory.getLogger(TsSession.class);

    /** Frames binarios navegador -> gateway */
    static final byte IN_OPUS = 0x01;
    static final byte IN_PCM = 0x02;
    /** Frames binarios gateway -> navegador: [tipo][clid u16 BE][codec u8][dados] */
    static final byte OUT_OPUS = 0x10;
    static final byte OUT_PCM = 0x11;

    private static final int CONNECT_TIMEOUT_MS = 20_000;
    private static final Set<String> STREAM_COMMANDS = Set.of(
            "joinstreamrequest", "streamsignaling", "requeststreaminfo");

    interface Sink {
        void sendText(String json);
        void sendBinary(ByteBuffer data);
        void close();
    }

    private final ObjectMapper mapper;
    private final Sink sink;
    private final Config config;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> daemon(r, "ts-session"));
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(r -> daemon(r, "ts-timer"));
    private final ServerState state = new ServerState();
    private final QueueMicrophone microphone = new QueueMicrophone();
    private final AtomicBoolean snapshotDirty = new AtomicBoolean();
    private final Map<Integer, OpusDecoder> pcmDecoders = new ConcurrentHashMap<>();

    private volatile LocalTeamspeakClientSocket socket;
    private volatile boolean pcmMode;
    private volatile boolean talking;
    private volatile boolean deafened;
    private volatile long generation;

    TsSession(ObjectMapper mapper, Config config, Sink sink) {
        this.mapper = mapper;
        this.config = config;
        this.sink = sink;
        timer.scheduleAtFixedRate(this::flushSnapshot, 150, 150, TimeUnit.MILLISECONDS);
    }

    // ---------------------------------------------------------------- navegador -> gateway

    void onText(String text) {
        JsonNode msg;
        try {
            msg = mapper.readTree(text);
        } catch (Exception e) {
            sendError("Mensagem invalida");
            return;
        }
        String type = msg.path("t").asText("");
        switch (type) {
            case "ping" -> send(obj("pong"));
            case "connect" -> worker.execute(() -> connect(msg));
            case "disconnect" -> worker.execute(() -> disconnect("Saindo"));
            case "join" -> worker.execute(() -> joinChannel(msg.path("cid").asInt(), msg.path("password").asText("")));
            case "talk" -> {
                talking = msg.path("on").asBoolean(false);
                if (!talking) microphone.clear();
            }
            case "deafen" -> deafened = msg.path("on").asBoolean(false);
            case "message" -> worker.execute(() -> sendTextMessage(msg));
            case "stream.join" -> raw("joinstreamrequest",
                    "id", msg.path("id").asText(), "clid", msg.path("clid").asText(), "msg", "", "is_remove", "0");
            case "stream.leave" -> raw("joinstreamrequest",
                    "id", msg.path("id").asText(), "clid", msg.path("clid").asText(), "msg", "", "is_remove", "1");
            case "stream.signal" -> raw("streamsignaling",
                    "id", msg.path("id").asText(), "clid", msg.path("clid").asText(), "json", msg.path("json").asText());
            case "stream.info" -> raw("requeststreaminfo", "clid", msg.path("clid").asText());
            default -> sendError("Comando desconhecido: " + type);
        }
    }

    void onBinary(byte[] data, int offset, int length) {
        if (!talking || length < 2) return;
        byte kind = data[offset];
        try {
            if (kind == IN_OPUS) {
                microphone.pushOpus(Arrays.copyOfRange(data, offset + 1, offset + length));
            } else if (kind == IN_PCM) {
                int samples = (length - 1) / 2;
                short[] pcm = new short[samples];
                ByteBuffer.wrap(data, offset + 1, length - 1).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(pcm);
                microphone.pushPcm(pcm);
            }
        } catch (OpusException e) {
            log.debug("Falha ao codificar audio do microfone", e);
        }
    }

    void onClose() {
        worker.execute(() -> disconnect("Cliente mobile desconectou"));
        worker.shutdown();
        timer.shutdownNow();
    }

    // ---------------------------------------------------------------- conexao

    private void connect(JsonNode msg) {
        disconnect(null);
        final long gen = ++generation;
        String host = msg.path("host").asText("").trim();
        int port = msg.path("port").asInt(9987);
        String nickname = msg.path("nickname").asText("").trim();
        String password = msg.path("password").asText("");
        pcmMode = "pcm".equals(msg.path("audio").asText("opus"));

        if (host.isEmpty() || nickname.isEmpty()) {
            status("error", "Informe endereco e apelido");
            return;
        }
        if (!config.isHostAllowed(host)) {
            status("error", "Este gateway nao permite conectar a " + host);
            return;
        }
        if (nickname.length() > 30) nickname = nickname.substring(0, 30);

        status("connecting", "Conectando a " + host + ":" + port);
        LocalTeamspeakClientSocket client = new LocalTeamspeakClientSocket();
        try {
            LocalIdentity identity = loadIdentity(msg.path("identity").asText(""));
            client.setIdentity(identity);
            client.setNickname(nickname);
            client.setHWID(identity.getUid().toBase64());
            client.setMicrophone(microphone);
            client.setExceptionHandler(err -> {
                if (gen == generation) log.debug("Erro de protocolo", err);
            });
            client.setVoiceHandler(packet -> onVoice(packet, gen));
            client.addListener(new Listener(client, gen));
            socket = client;
            state.clear();

            InetSocketAddress address = new InetSocketAddress(InetAddress.getByName(host), port);
            client.connect(address, password.isEmpty() ? null : password, CONNECT_TIMEOUT_MS);
            if (gen != generation) {
                closeQuietly(client);
                return;
            }
            try {
                client.subscribeAll();
            } catch (Exception e) {
                log.debug("subscribeall indisponivel", e);
            }
            markDirty();
            status("connected", null);
            requestStreamsAround();
        } catch (TimeoutException e) {
            failConnect(client, gen, "Tempo esgotado: o servidor nao respondeu (verifique endereco/porta UDP)");
        } catch (Exception e) {
            failConnect(client, gen, describe(e));
        }
    }

    private void failConnect(LocalTeamspeakClientSocket client, long gen, String reason) {
        log.info("Falha ao conectar: {}", reason);
        closeQuietly(client);
        if (gen == generation) {
            socket = null;
            state.clear();
            status("error", reason);
        }
    }

    private void disconnect(String reason) {
        LocalTeamspeakClientSocket current = socket;
        socket = null;
        generation++;
        microphone.clear();
        pcmDecoders.clear();
        state.clear();
        if (current == null) return;
        try {
            if (current.isConnected()) current.disconnect(reason == null ? "" : reason);
        } catch (Exception e) {
            log.debug("Erro ao desconectar", e);
        }
        closeQuietly(current);
        if (reason != null) status("disconnected", null);
    }

    private LocalIdentity loadIdentity(String exported) throws Exception {
        if (!exported.isBlank()) {
            try {
                return LocalIdentity.read(new ByteArrayInputStream(exported.getBytes(StandardCharsets.UTF_8)));
            } catch (Exception e) {
                log.info("Identidade recebida invalida, gerando nova");
            }
        }
        return createIdentity();
    }

    private LocalIdentity createIdentity() throws Exception {
        LocalIdentity identity = LocalIdentity.generateNew(config.identityLevel());
        ObjectNode out = obj("identity");
        out.put("value", identity.export());
        out.put("uid", identity.getUid().toBase64());
        send(out);
        return identity;
    }

    // ---------------------------------------------------------------- acoes

    private void joinChannel(int cid, String password) {
        LocalTeamspeakClientSocket client = connected();
        if (client == null || cid <= 0) return;
        try {
            client.joinChannel(cid, password.isEmpty() ? null : password);
            state.moveClient(client.getClientId(), cid);
            markDirty();
            requestStreamsAround();
        } catch (Exception e) {
            sendError("Nao foi possivel entrar no canal: " + describe(e));
        }
    }

    private void sendTextMessage(JsonNode msg) {
        LocalTeamspeakClientSocket client = connected();
        String text = msg.path("text").asText("");
        if (client == null || text.isBlank()) return;
        try {
            switch (msg.path("mode").asText("channel")) {
                case "private" -> client.sendPrivateMessage(msg.path("target").asInt(), text);
                case "server" -> client.sendServerMessage(text);
                default -> {
                    Integer cid = state.clientChannel(client.getClientId());
                    if (cid != null) client.sendChannelMessage(cid, text);
                }
            }
        } catch (Exception e) {
            sendError("Mensagem nao enviada: " + describe(e));
        }
    }

    /** Envia um comando cru preservando os valores (SDP precisa do CRLF final). */
    private void raw(String command, String... kv) {
        if (!STREAM_COMMANDS.contains(command)) return;
        LocalTeamspeakClientSocket client = connected();
        if (client == null) return;
        List<CommandParameter> params = new ArrayList<>();
        for (int i = 0; i + 1 < kv.length; i += 2) params.add(new RawParameter(kv[i], kv[i + 1]));
        worker.execute(() -> {
            try {
                client.executeCommand(new SingleCommand(command, ProtocolRole.CLIENT, params)).get(10_000L);
            } catch (Exception e) {
                log.debug("Comando {} falhou", command, e);
                if (!"requeststreaminfo".equals(command)) sendError("Stream: " + describe(e));
            }
        });
    }

    private void requestStreamsAround() {
        LocalTeamspeakClientSocket client = connected();
        if (client == null) return;
        int self = client.getClientId();
        timer.schedule(() -> {
            for (Integer clid : state.clientIds()) {
                if (clid != self) raw("requeststreaminfo", "clid", Integer.toString(clid));
            }
        }, 300, TimeUnit.MILLISECONDS);
    }

    // ---------------------------------------------------------------- audio recebido

    private void onVoice(PacketBody0Voice packet, long gen) {
        if (gen != generation || deafened) return;
        byte[] data = packet.getCodecData();
        CodecType codec = packet.getCodecType();
        int clid = packet.getClientId();
        boolean opus = codec == CodecType.OPUS_VOICE || codec == CodecType.OPUS_MUSIC;
        if (!opus) return; // codecs legados (Speex/CELT) nao sao suportados

        if (!pcmMode || data == null || data.length == 0) {
            int len = data == null ? 0 : data.length;
            ByteBuffer buf = ByteBuffer.allocate(4 + len);
            buf.put(OUT_OPUS).putShort((short) clid).put((byte) codec.getIndex());
            if (len > 0) buf.put(data);
            buf.flip();
            sink.sendBinary(buf);
            if (len == 0) pcmDecoders.remove(clid);
            return;
        }
        try {
            OpusDecoder decoder = pcmDecoders.computeIfAbsent(clid, k -> {
                try {
                    return new OpusDecoder(QueueMicrophone.SAMPLE_RATE, 1);
                } catch (OpusException e) {
                    throw new IllegalStateException(e);
                }
            });
            short[] pcm = new short[5760];
            int samples = decoder.decode(data, 0, data.length, pcm, 0, pcm.length, false);
            ByteBuffer buf = ByteBuffer.allocate(4 + samples * 2).order(ByteOrder.LITTLE_ENDIAN);
            buf.put(OUT_PCM);
            buf.order(ByteOrder.BIG_ENDIAN).putShort((short) clid).order(ByteOrder.LITTLE_ENDIAN);
            buf.put((byte) codec.getIndex());
            for (int i = 0; i < samples; i++) buf.putShort(pcm[i]);
            buf.flip();
            sink.sendBinary(buf);
        } catch (Exception e) {
            log.debug("Falha ao decodificar voz de {}", clid, e);
        }
    }

    // ---------------------------------------------------------------- eventos do servidor

    private final class Listener implements TS3Listener {
        private final LocalTeamspeakClientSocket client;
        private final long gen;

        Listener(LocalTeamspeakClientSocket client, long gen) {
            this.client = client;
            this.gen = gen;
        }

        private boolean stale() {
            return gen != generation;
        }

        @Override public void onChannelList(ChannelListEvent e) { if (!stale()) { state.putChannel(e.getChannelId(), e.getMap()); markDirty(); } }
        @Override public void onChannelCreate(ChannelCreateEvent e) { if (!stale()) { state.putChannel(e.getChannelId(), e.getMap()); markDirty(); } }
        @Override public void onChannelEdit(ChannelEditedEvent e) { if (!stale()) { state.putChannel(e.getChannelId(), e.getMap()); markDirty(); } }
        @Override public void onChannelDeleted(ChannelDeletedEvent e) { if (!stale()) { state.removeChannel(e.getChannelId()); markDirty(); } }

        @Override
        public void onChannelMoved(ChannelMovedEvent e) {
            if (stale()) return;
            state.putChannel(e.getChannelId(), Map.of(
                    "cpid", Integer.toString(e.getChannelParentId()),
                    "channel_order", Integer.toString(e.getChannelOrder())));
            markDirty();
        }

        @Override
        public void onClientJoin(ClientJoinEvent e) {
            if (stale()) return;
            Map<String, String> props = new HashMap<>(e.getMap());
            props.put("cid", Integer.toString(e.getClientTargetId()));
            state.putClient(e.getClientId(), props);
            markDirty();
            if (client.isConnected() && e.getClientId() != client.getClientId() && e.getClientType() == 0) {
                raw("requeststreaminfo", "clid", Integer.toString(e.getClientId()));
            }
        }

        @Override
        public void onClientLeave(ClientLeaveEvent e) {
            if (stale()) return;
            state.removeClient(e.getClientId());
            pcmDecoders.remove(e.getClientId());
            markDirty();
        }

        @Override
        public void onClientMoved(ClientMovedEvent e) {
            if (stale()) return;
            if (!state.hasClient(e.getClientId())) {
                // Cliente entrou no nosso campo de visao por movimento: o mapa traz as propriedades
                Map<String, String> props = new HashMap<>(e.getMap());
                state.putClient(e.getClientId(), props);
            }
            state.moveClient(e.getClientId(), e.getTargetChannelId());
            markDirty();
            if (client.isConnected() && e.getClientId() == client.getClientId()) requestStreamsAround();
        }

        @Override
        public void onClientChanged(ClientUpdatedEvent e) {
            if (stale()) return;
            state.putClient(e.getClientId(), e.getMap());
            markDirty();
        }

        @Override
        public void onTextMessage(TextMessageEvent e) {
            if (stale()) return;
            ObjectNode out = obj("message");
            out.put("mode", switch (e.getTargetMode()) {
                case CLIENT -> "private";
                case SERVER -> "server";
                default -> "channel";
            });
            out.put("from", e.getInvokerId());
            out.put("fromName", e.getInvokerName());
            out.put("text", e.getMessage());
            out.put("at", System.currentTimeMillis());
            send(out);
        }

        @Override
        public void onClientPoke(ClientPokeEvent e) {
            if (stale()) return;
            ObjectNode out = obj("poke");
            out.put("fromName", e.getInvokerName());
            out.put("text", e.getMap().getOrDefault("msg", ""));
            send(out);
        }

        @Override
        public void onDisconnected(DisconnectedEvent e) {
            if (stale()) return;
            socket = null;
            generation++;
            state.clear();
            closeQuietly(client);
            String reason = e.getMap().getOrDefault("reasonmsg", "");
            status("disconnected", reason.isEmpty() ? "Desconectado pelo servidor" : reason);
        }

        @Override
        public void onUnknownEvent(UnknownTeamspeakEvent e) {
            if (stale()) return;
            handleStreamEvent(e.getCommand(), e.getMap(), e.getInvokerId());
        }
    }

    /** Notificacoes do TS6 relativas a streams (camera / compartilhamento de tela). */
    private void handleStreamEvent(String command, Map<String, String> map, int invokerId) {
        String id = map.getOrDefault("id", map.getOrDefault("streamid", ""));
        int clid = parseInt(map.get("clid"), invokerId);
        switch (command) {
            case "notifystreamstarted", "notifystreaminfo", "notifystreamupdated" -> {
                if (id.isEmpty()) return;
                Map<String, String> props = new HashMap<>(map);
                if (clid > 0) props.put("clid", Integer.toString(clid));
                state.putStream(id, props);
                markDirty();
            }
            case "notifystreamstopped" -> {
                state.removeStream(id);
                markDirty();
                ObjectNode out = obj("stream.stopped");
                out.put("id", id);
                out.put("clid", clid);
                send(out);
            }
            case "notifyrespondjoinstreamrequest" -> {
                ObjectNode out = obj("stream.response");
                out.put("id", id);
                out.put("clid", clid);
                out.put("decision", map.getOrDefault("decision", map.getOrDefault("status", "")));
                out.put("offer", map.getOrDefault("offer", ""));
                out.put("msg", map.getOrDefault("msg", ""));
                send(out);
            }
            case "notifystreamsignaling" -> {
                ObjectNode out = obj("stream.signal");
                out.put("id", id);
                out.put("clid", clid);
                out.put("json", firstNonEmpty(map, "json", "msg", "signaling", "data"));
                send(out);
            }
            default -> log.debug("Evento nao tratado {} {}", command, map.keySet());
        }
    }

    // ---------------------------------------------------------------- utilitarios

    private LocalTeamspeakClientSocket connected() {
        LocalTeamspeakClientSocket client = socket;
        return client != null && client.isConnected() ? client : null;
    }

    private void markDirty() {
        snapshotDirty.set(true);
    }

    private void flushSnapshot() {
        if (!snapshotDirty.getAndSet(false)) return;
        try {
            LocalTeamspeakClientSocket client = socket;
            int self = client != null && client.isConnected() ? client.getClientId() : 0;
            ObjectNode snap = state.snapshot(mapper, self);
            snap.put("t", "state");
            send(snap);
        } catch (Exception e) {
            log.debug("Falha ao publicar estado", e);
        }
    }

    private void status(String phase, String message) {
        ObjectNode out = obj("status");
        out.put("phase", phase);
        if (message != null) out.put("message", message);
        send(out);
        if ("connected".equals(phase) || "disconnected".equals(phase) || "error".equals(phase)) markDirty();
    }

    private void sendError(String message) {
        ObjectNode out = obj("error");
        out.put("message", message);
        send(out);
    }

    private ObjectNode obj(String type) {
        ObjectNode n = mapper.createObjectNode();
        n.put("t", type);
        return n;
    }

    private void send(ObjectNode node) {
        try {
            sink.sendText(mapper.writeValueAsString(node));
        } catch (Exception e) {
            log.debug("Falha ao enviar ao navegador", e);
        }
    }

    private static String firstNonEmpty(Map<String, String> map, String... keys) {
        for (String k : keys) {
            String v = map.get(k);
            if (v != null && !v.isEmpty()) return v;
        }
        return "";
    }

    private static int parseInt(String v, int fallback) {
        try {
            return v == null ? fallback : Integer.parseInt(v);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    static String describe(Throwable e) {
        Throwable root = e;
        while (root.getCause() != null && root.getCause() != root) root = root.getCause();
        String msg = root.getMessage();
        return msg == null || msg.isBlank() ? root.getClass().getSimpleName() : msg;
    }

    private static void closeQuietly(LocalTeamspeakClientSocket client) {
        try {
            client.close();
        } catch (Exception ignored) {
        }
    }

    private static Thread daemon(Runnable r, String name) {
        Thread t = new Thread(r, name);
        t.setDaemon(true);
        return t;
    }
}
