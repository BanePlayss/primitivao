# davinci-mcp — servidor MCP pro DaVinci Resolve (Primitivão)

Controla o DaVinci Resolve via Claude Code: cortes, zooms, markers,
titles e qualquer outra coisa da API de scripting.

## Arquitetura

```
Claude Code ──MCP/stdio──> server.py ──> resolve_client.py ──┐
                                                             │ 1) "direct": API externa (so Studio)
                                                             │ 2) "bridge": TCP 127.0.0.1:51999
DaVinci Resolve <── primitivao_bridge.py (roda DENTRO do Resolve) ◄┘
```

A versao **free** do Resolve bloqueia scripting externo, mas permite
scripts internos. A ponte (`bridge/primitivao_bridge.py`) roda dentro do
Resolve e abre um servidor local **so em 127.0.0.1** que executa comandos
da API. O cliente tenta o modo direct primeiro (Studio) e cai pro bridge.

## Setup (ja feito nesta maquina)

1. Ponte instalada em
   `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility\primitivao_bridge.py`
2. Runtime copiado pra `C:\Users\bane\.claude\tools\davinci-mcp\`
   (o registro MCP aponta pra la — fonte de verdade e este diretorio do repo;
   se editar aqui, recopiar pra la).
3. Registrado: `claude mcp add --scope user davinci-resolve -- python C:\Users\bane\.claude\tools\davinci-mcp\server.py`
4. `pip install mcp`

## Uso

1. Abre o DaVinci Resolve com o projeto.
2. **Workspace > Scripts > primitivao_bridge** (uma vez por sessao do Resolve).
3. Nova sessao do Claude Code → as tools `davinci-resolve` aparecem.

## Tools

- `resolve_status` — projeto, timeline, fps, tracks.
- `get_timeline_clips` — clips por track com frames/timecode.
- `run_python` — executa Python arbitrario dentro do Resolve
  (`resolve`, `proj`, `tl`, `_fps()`, `_tc()` no namespace; setar `_result`).
- `set_clip_transform` — zoom/pan/tilt estatico (punch-in).
- `delete_clips` — deleta clips por indice (com ripple opcional).
- `add_marker`, `set_playhead`, `append_subclip`, `save_project`.

Nao tem tool de "split" porque a API classica nao expoe razor cut — corte
se faz deletando ranges ou reconstruindo por subclips (`append_subclip`
com startFrame/endFrame do source). Se a API do Resolve 21 tiver split,
descobrir via `run_python` com `dir(tl)` / `dir(item)` e usar por la.

## Seguranca

A ponte executa Python arbitrario, mas SO aceita conexao de 127.0.0.1
(localhost). Nao expor a porta 51999. Encerrar: op `shutdown` ou fechar o
Resolve.
