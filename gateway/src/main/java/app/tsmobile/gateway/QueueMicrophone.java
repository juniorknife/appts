package app.tsmobile.gateway;

import com.github.manevolent.ts3j.audio.Microphone;
import com.github.manevolent.ts3j.enums.CodecType;
import io.github.jaredmdobson.concentus.OpusApplication;
import io.github.jaredmdobson.concentus.OpusEncoder;
import io.github.jaredmdobson.concentus.OpusException;

import java.util.concurrent.ConcurrentLinkedDeque;

/**
 * Microfone alimentado pelo navegador. O ts3j consome um frame Opus a cada 20 ms;
 * o navegador envia frames Opus ja codificados (WebCodecs) ou PCM 48 kHz mono,
 * que e codificado aqui com o Concentus (Opus em Java puro).
 */
final class QueueMicrophone implements Microphone {
    static final int SAMPLE_RATE = 48_000;
    static final int FRAME_SAMPLES = 960; // 20 ms
    private static final int MAX_QUEUED_FRAMES = 8; // ~160 ms: descarta o excesso para manter latencia baixa

    private final ConcurrentLinkedDeque<byte[]> frames = new ConcurrentLinkedDeque<>();
    private OpusEncoder encoder;

    @Override
    public boolean isReady() {
        return !frames.isEmpty();
    }

    @Override
    public CodecType getCodec() {
        return CodecType.OPUS_VOICE;
    }

    @Override
    public byte[] provide() {
        byte[] frame = frames.poll();
        return frame == null ? new byte[0] : frame;
    }

    void pushOpus(byte[] frame) {
        if (frame.length == 0) return;
        frames.add(frame);
        while (frames.size() > MAX_QUEUED_FRAMES) frames.poll();
    }

    /** PCM int16 little-endian, 48 kHz mono, exatamente 960 amostras. */
    synchronized void pushPcm(short[] pcm) throws OpusException {
        if (pcm.length != FRAME_SAMPLES) return;
        if (encoder == null) {
            encoder = new OpusEncoder(SAMPLE_RATE, 1, OpusApplication.OPUS_APPLICATION_VOIP);
            encoder.setBitrate(32_000);
            encoder.setComplexity(5);
        }
        byte[] out = new byte[1275];
        int len = encoder.encode(pcm, 0, FRAME_SAMPLES, out, 0, out.length);
        if (len > 0) {
            byte[] frame = new byte[len];
            System.arraycopy(out, 0, frame, 0, len);
            pushOpus(frame);
        }
    }

    void clear() {
        frames.clear();
    }
}
