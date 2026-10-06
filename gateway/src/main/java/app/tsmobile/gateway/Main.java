package app.tsmobile.gateway;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.http.staticfiles.Location;
import io.javalin.websocket.WsContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public final class Main {
    private static final Logger log = LoggerFactory.getLogger(Main.class);

    public static void main(String[] args) {
        Config config = Config.fromEnv();
        ObjectMapper mapper = new ObjectMapper();
        Map<String, TsSession> sessions = new ConcurrentHashMap<>();
        Path web = Path.of(config.webDir()).toAbsolutePath().normalize();

        Javalin app = Javalin.create(cfg -> {
            cfg.showJavalinBanner = false;
            cfg.jetty.modifyWebSocketServletFactory(f -> {
                f.setIdleTimeout(Duration.ofMinutes(2));
                f.setMaxTextMessageSize(256 * 1024);
                f.setMaxBinaryMessageSize(64 * 1024);
            });
            if (Files.isDirectory(web)) {
                cfg.staticFiles.add(s -> {
                    s.directory = web.toString();
                    s.location = Location.EXTERNAL;
                    s.headers = Map.of("Cache-Control", "no-cache");
                });
                cfg.spaRoot.addFile("/", web.resolve("index.html").toString(), Location.EXTERNAL);
            } else {
                log.warn("WEB_DIR {} nao existe; servindo apenas a API", web);
            }
        });

        app.get("/api/health", ctx -> ctx.json(Map.of(
                "ok", true,
                "auth", !config.accessToken().isEmpty(),
                "sessions", sessions.size())));

        app.ws("/ws", ws -> {
            ws.onConnect(ctx -> {
                if (!authorized(config, ctx.queryParam("token"))) {
                    ctx.closeSession(4401, "Token de acesso invalido");
                    return;
                }
                ctx.enableAutomaticPings(20, java.util.concurrent.TimeUnit.SECONDS);
                TsSession session = new TsSession(mapper, config, new WsSink(ctx));
                sessions.put(ctx.sessionId(), session);
                log.info("Sessao aberta {} ({} ativas)", ctx.sessionId(), sessions.size());
            });
            ws.onMessage(ctx -> {
                TsSession s = sessions.get(ctx.sessionId());
                if (s != null) s.onText(ctx.message());
            });
            ws.onBinaryMessage(ctx -> {
                TsSession s = sessions.get(ctx.sessionId());
                if (s != null) s.onBinary(ctx.data(), ctx.offset(), ctx.length());
            });
            ws.onClose(ctx -> {
                TsSession s = sessions.remove(ctx.sessionId());
                if (s != null) s.onClose();
                log.info("Sessao encerrada {} ({} ativas)", ctx.sessionId(), sessions.size());
            });
            ws.onError(ctx -> log.debug("Erro no WebSocket {}", ctx.sessionId(), ctx.error()));
        });

        app.start(config.port());
        log.info("Gateway TS Mobile em http://0.0.0.0:{} (web: {})", config.port(), web);
    }

    private static boolean authorized(Config config, String token) {
        if (config.accessToken().isEmpty()) return true;
        if (token == null) return false;
        return MessageDigest.isEqual(
                config.accessToken().getBytes(StandardCharsets.UTF_8),
                token.getBytes(StandardCharsets.UTF_8));
    }

    /** Envio serializado: o Jetty nao aceita escritas concorrentes na mesma sessao. */
    private static final class WsSink implements TsSession.Sink {
        private final WsContext ctx;

        WsSink(WsContext ctx) {
            this.ctx = ctx;
        }

        @Override
        public synchronized void sendText(String json) {
            if (ctx.session.isOpen()) ctx.send(json);
        }

        @Override
        public synchronized void sendBinary(ByteBuffer data) {
            if (ctx.session.isOpen()) ctx.send(data);
        }

        @Override
        public void close() {
            ctx.closeSession();
        }
    }
}
