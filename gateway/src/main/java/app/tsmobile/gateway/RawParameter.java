package app.tsmobile.gateway;

import com.github.manevolent.ts3j.command.parameter.CommandParameter;
import com.github.manevolent.ts3j.util.Ts3String;

/**
 * Parametro de comando que preserva o valor exatamente como recebido.
 * O CommandSingleParameter do ts3j aplica trim(), o que remove o CRLF final
 * exigido pelas descricoes SDP usadas no compartilhamento de tela do TS6.
 */
final class RawParameter implements CommandParameter {
    private final String name;
    private String value;

    RawParameter(String name, String value) {
        this.name = name;
        this.value = value == null ? "" : value;
    }

    @Override public String getName() { return name; }
    @Override public String getValue() { return value; }
    @Override public void set(char v) { value = String.valueOf(v); }
    @Override public void set(String v) { value = v == null ? "" : v; }
    @Override public void set(boolean v) { value = v ? "1" : "0"; }
    @Override public void set(byte v) { value = String.valueOf(v); }
    @Override public void set(short v) { value = String.valueOf(v); }
    @Override public void set(int v) { value = String.valueOf(v); }
    @Override public void set(long v) { value = String.valueOf(v); }
    @Override public void set(float v) { value = String.valueOf(v); }
    @Override public void set(double v) { value = String.valueOf(v); }

    @Override
    public String toString() {
        return name + "=" + Ts3String.escape(value);
    }
}
