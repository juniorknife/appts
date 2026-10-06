# TS Mobile

Cliente mobile (PWA) para servidores **TeamSpeak 6**, com foco em:

- entrar no servidor e navegar pelos canais;
- ouvir e falar por voz (segurar para falar ou microfone aberto com ativação por voz);
- **assistir compartilhamentos de tela e câmera do TS6**, com zoom por pinça, mini player, tela cheia em paisagem e picture-in-picture.

Instale pelo navegador do celular: menu → "Adicionar à tela inicial".

## Como funciona

O navegador não consegue falar o protocolo do TeamSpeak, que roda sobre UDP com criptografia própria. Por isso o projeto tem duas partes:

```
 Celular (PWA)  ──WebSocket──►  Gateway (Java)  ──UDP / protocolo TS──►  Servidor TS6
      │                                                                     │
      └──────────────── WebRTC (vídeo da tela, direto) ◄────────────────────┘
```

| Parte | O que faz |
|---|---|
| `web/` | App React + Vite (PWA). Interface, áudio (WebCodecs/Opus) e o **WebRTC nativo do navegador** para receber o vídeo. |
| `gateway/` | Servidor Java (Javalin) que usa o [ts3j](https://github.com/Manevolent/ts3j) (Apache-2.0) para se conectar ao TS como um cliente. Repassa ao app o estado dos canais, a voz em Opus e a sinalização (SDP/ICE) das streams. |

O vídeo da tela **não passa pelo gateway**. O gateway só repassa a negociação, e a mídia vai por WebRTC direto para o celular. A voz passa pelo gateway em Opus (cerca de 4 KB/s por pessoa falando).

Cada pessoa usa a própria identidade TeamSpeak. Ela é gerada na primeira conexão e fica salva no navegador (Ajustes → Identidade, onde dá para exportar ou importar).

## Rodando

### Docker (recomendado)

```bash
docker compose up -d --build
# abra http://SEU_HOST:8080 no celular
```

Para usar fora de casa, coloque o gateway atrás de HTTPS (Caddy, Nginx, Cloudflare Tunnel...). O navegador **exige HTTPS** para liberar o microfone e instalar o PWA. Se o gateway ficar exposto na internet, defina `ACCESS_TOKEN` e preencha o mesmo token em Ajustes no app.

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `8080` | Porta HTTP/WebSocket |
| `ACCESS_TOKEN` | vazio | Token exigido do app (recomendado em servidor público) |
| `ALLOWED_HOSTS` | vazio | Servidores TS permitidos, ex.: `ts.meuclan.com,*.clan.gg` |
| `IDENTITY_LEVEL` | `8` | Nível de segurança das identidades novas |
| `WEB_DIR` | `../web/dist` | Pasta do app compilado |

### Desenvolvimento

```bash
./scripts/install-ts3j.sh                 # uma vez: ts3j não está no Maven Central
cd gateway && mvn package && java -jar target/gateway.jar
cd web && npm install && npm run dev      # http://localhost:5173 (proxy /ws -> 8080)
```

Testes: `cd gateway && mvn test` e `cd web && npm test`.

**Modo demonstração:** adicione um servidor com endereço `demo`. Ele simula canais, pessoas falando e uma transmissão de tela, o que serve para testar a interface sem servidor nem gateway.

## Compatibilidade

| Recurso | Android (Chrome) | iPhone (Safari) |
|---|---|---|
| Canais, chat | ✅ | ✅ |
| Ouvir voz | ✅ WebCodecs | ✅ (WebCodecs; em versões antigas o gateway decodifica e envia PCM) |
| Falar | ✅ | ✅ (sem `AudioEncoder`, o PCM vai ao gateway, que codifica em Opus) |
| Assistir tela/câmera | ✅ | ✅ |
| Tela cheia em paisagem | ✅ | só o vídeo (limitação do iOS) |

## Estado atual e limitações

- O protocolo de streams do TS6 não é documentado. Os comandos usados (`joinstreamrequest`, `notifystreamsignaling`, `streamsignaling`, `notifystreaminfo`...) foram observados em clientes abertos que funcionam com TS6. Se uma versão nova do servidor mudar o formato, o ajuste fica em `web/src/lib/signaling.ts` e em `TsSession.handleStreamEvent`.
- Ainda não testado contra um servidor TS6 real a partir deste repositório. Veja "Primeiro teste real" abaixo.
- Por enquanto o app só **assiste**: transmitir a tela do celular não está implementado.
- Ainda não implementados: sussurro (whisper), transferência de arquivos, administração/permissões e vários servidores ao mesmo tempo.
- Speex/CELT (codecs legados do TS3) não são suportados. TS5/TS6 usam Opus.
- No iOS, áudio em segundo plano com a tela bloqueada é limitado pelo sistema.

### Primeiro teste real

1. Suba o gateway e conecte em um servidor TS6.
2. Peça para alguém no **mesmo canal** compartilhar a tela pelo cliente oficial.
3. Abra a aba **Ao vivo** e toque em *Assistir*.
4. Se não funcionar, rode o gateway com `-Dorg.slf4j.simpleLogger.defaultLogLevel=debug` e veja os eventos `notifystream*` no log. Eles mostram o formato que o servidor está usando.
