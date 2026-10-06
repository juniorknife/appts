package app.tsmobile.gateway;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/** Configuracao via variaveis de ambiente. */
record Config(int port, String webDir, String accessToken, List<String> allowedHosts, int identityLevel) {

    static Config fromEnv() {
        return new Config(
                Integer.parseInt(env("PORT", "8080")),
                env("WEB_DIR", "../web/dist"),
                env("ACCESS_TOKEN", ""),
                Arrays.stream(env("ALLOWED_HOSTS", "").split(","))
                        .map(s -> s.trim().toLowerCase(Locale.ROOT))
                        .filter(s -> !s.isEmpty())
                        .toList(),
                Integer.parseInt(env("IDENTITY_LEVEL", "8")));
    }

    /** Lista vazia = qualquer servidor. Aceita curinga de prefixo: "*.meuclan.com". */
    boolean isHostAllowed(String host) {
        if (allowedHosts.isEmpty()) return true;
        String h = host.toLowerCase(Locale.ROOT);
        for (String rule : allowedHosts) {
            if (rule.startsWith("*.") ? h.endsWith(rule.substring(1)) : h.equals(rule)) return true;
        }
        return false;
    }

    private static String env(String key, String fallback) {
        String v = System.getenv(key);
        return v == null || v.isBlank() ? fallback : v;
    }
}
