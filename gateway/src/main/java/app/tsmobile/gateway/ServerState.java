package app.tsmobile.gateway;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Espelho do estado do servidor (canais, clientes, streams) montado a partir das
 * notificacoes do protocolo. As propriedades sao guardadas cruas (chave/valor do TS)
 * e mescladas a cada atualizacao; o snapshot so expoe o que o app usa.
 */
final class ServerState {
    private static final List<String> CHANNEL_KEYS = List.of(
            "channel_name", "channel_topic", "channel_flag_password", "channel_flag_default",
            "channel_maxclients", "channel_needed_talk_power", "channel_flag_permanent",
            "channel_flag_semi_permanent");
    private static final List<String> CLIENT_KEYS = List.of(
            "client_nickname", "client_input_muted", "client_output_muted", "client_away",
            "client_away_message", "client_input_hardware", "client_output_hardware",
            "client_is_recording", "client_talk_power", "client_is_priority_speaker",
            "client_is_channel_commander", "client_country", "client_description", "client_unique_identifier");

    private final Map<Integer, Map<String, String>> channels = new ConcurrentHashMap<>();
    private final Map<Integer, Map<String, String>> clients = new ConcurrentHashMap<>();
    private final Map<String, Map<String, String>> streams = new ConcurrentHashMap<>();

    void clear() {
        channels.clear();
        clients.clear();
        streams.clear();
    }

    void putChannel(int cid, Map<String, String> props) {
        channels.computeIfAbsent(cid, k -> new ConcurrentHashMap<>()).putAll(nonNull(props));
    }

    void removeChannel(int cid) {
        channels.remove(cid);
    }

    void putClient(int clid, Map<String, String> props) {
        clients.computeIfAbsent(clid, k -> new ConcurrentHashMap<>()).putAll(nonNull(props));
    }

    void moveClient(int clid, int cid) {
        Map<String, String> c = clients.get(clid);
        if (c != null) c.put("cid", Integer.toString(cid));
    }

    void removeClient(int clid) {
        clients.remove(clid);
        streams.values().removeIf(s -> Integer.toString(clid).equals(s.get("clid")));
    }

    boolean hasClient(int clid) {
        return clients.containsKey(clid);
    }

    Iterable<Integer> clientIds() {
        return clients.keySet();
    }

    Integer clientChannel(int clid) {
        Map<String, String> c = clients.get(clid);
        if (c == null) return null;
        try {
            return Integer.parseInt(c.getOrDefault("cid", "0"));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    void putStream(String id, Map<String, String> props) {
        streams.computeIfAbsent(id, k -> new ConcurrentHashMap<>()).putAll(nonNull(props));
    }

    void removeStream(String id) {
        streams.remove(id);
    }

    ObjectNode snapshot(ObjectMapper mapper, int ownClientId) {
        ObjectNode root = mapper.createObjectNode();
        root.put("self", ownClientId);

        ArrayNode chs = root.putArray("channels");
        channels.forEach((cid, p) -> {
            ObjectNode n = chs.addObject();
            n.put("id", cid);
            n.put("parent", intOf(p, "cpid", 0));
            n.put("order", intOf(p, "channel_order", 0));
            for (String k : CHANNEL_KEYS) if (p.containsKey(k)) n.put(k, p.get(k));
        });

        ArrayNode cls = root.putArray("clients");
        clients.forEach((clid, p) -> {
            // client_type 1 = ServerQuery: o cliente oficial tambem os esconde
            if ("1".equals(p.get("client_type"))) return;
            ObjectNode n = cls.addObject();
            n.put("id", clid);
            n.put("channel", intOf(p, "cid", 0));
            for (String k : CLIENT_KEYS) if (p.containsKey(k)) n.put(k, p.get(k));
        });

        ArrayNode sts = root.putArray("streams");
        streams.forEach((id, p) -> {
            ObjectNode n = sts.addObject();
            n.put("id", id);
            n.put("client", intOf(p, "clid", 0));
            n.put("type", intOf(p, "type", 1));
            n.put("name", p.getOrDefault("name", ""));
            n.put("width", intOf(p, "width", 0));
            n.put("height", intOf(p, "height", 0));
            n.put("fps", intOf(p, "fps", 0));
            n.put("audio", "1".equals(p.get("audio")));
        });
        return root;
    }

    private static int intOf(Map<String, String> p, String key, int fallback) {
        String v = p.get(key);
        if (v == null || v.isEmpty()) return fallback;
        try {
            return Integer.parseInt(v);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static Map<String, String> nonNull(Map<String, String> props) {
        Map<String, String> out = new HashMap<>();
        if (props != null) props.forEach((k, v) -> { if (k != null && v != null) out.put(k, v); });
        return out;
    }
}
