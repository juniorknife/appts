package app.tsmobile.gateway;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.github.manevolent.ts3j.identity.LocalIdentity;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class GatewayTest {

    @Test
    void identityExportRoundTripsAndMeetsSecurityLevel() throws Exception {
        LocalIdentity original = LocalIdentity.generateNew(8);
        String exported = original.export();
        LocalIdentity loaded = LocalIdentity.read(new ByteArrayInputStream(exported.getBytes(StandardCharsets.UTF_8)));
        assertEquals(original.getUid().toBase64(), loaded.getUid().toBase64());
        assertTrue(loaded.getSecurityLevel() >= 8);
    }

    @Test
    void rawParameterKeepsTrailingCrlfOfSdp() {
        String sdp = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n";
        RawParameter p = new RawParameter("offer", sdp);
        assertEquals(sdp, p.getValue());
        assertTrue(p.toString().endsWith("\\r\\n"), p.toString());
    }

    @Test
    void snapshotHidesQueryClientsAndTracksStreams() {
        ServerState state = new ServerState();
        state.putChannel(1, Map.of("channel_name", "Lobby", "cpid", "0", "channel_order", "0"));
        state.putClient(5, Map.of("client_nickname", "Ana", "client_type", "0", "cid", "1"));
        state.putClient(6, Map.of("client_nickname", "bot", "client_type", "1", "cid", "1"));
        state.putStream("abc", Map.of("clid", "5", "type", "2", "name", "Screen"));
        state.moveClient(5, 1);

        ObjectNode snap = state.snapshot(new ObjectMapper(), 5);
        assertEquals(1, snap.get("clients").size());
        assertEquals("Ana", snap.get("clients").get(0).get("client_nickname").asText());
        assertEquals("abc", snap.get("streams").get(0).get("id").asText());

        state.removeClient(5);
        assertEquals(0, state.snapshot(new ObjectMapper(), 0).get("streams").size(), "streams do cliente saem junto");
    }

    @Test
    void allowedHostsSupportsWildcard() {
        Config open = new Config(8080, "", "", List.of(), 8);
        assertTrue(open.isHostAllowed("qualquer.com"));
        Config restricted = new Config(8080, "", "", List.of("ts.exemplo.com", "*.clan.gg"), 8);
        assertTrue(restricted.isHostAllowed("TS.exemplo.com"));
        assertTrue(restricted.isHostAllowed("voz.clan.gg"));
        assertFalse(restricted.isHostAllowed("clan.gg.evil.com"));
        assertFalse(restricted.isHostAllowed("outro.com"));
    }
}
