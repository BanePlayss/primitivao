# server.py — servidor MCP do DaVinci Resolve pro Primitivão.
#
# Expoe ferramentas de edicao (cortes, zoom, markers, titles) em cima do
# resolve_client (modo direct no Studio, modo bridge na versao free).
#
# Registro (escopo user, qualquer sessao):
#   claude mcp add --scope user davinci-resolve -- python <este arquivo>

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp.server.fastmcp import FastMCP
from resolve_client import ResolveClient, ResolveError, PRELUDE

mcp = FastMCP("davinci-resolve")
_client = ResolveClient()


def _run(code, timeout=120):
    try:
        return json.dumps(_client.run(PRELUDE + code, timeout=timeout), ensure_ascii=False)
    except ResolveError as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)


@mcp.tool()
def resolve_status() -> str:
    """Estado geral: modo de conexao, projeto, timeline atual, fps, tracks e duracao."""
    out = _run(r"""
info = {"project": proj.GetName(), "timeline": None}
if tl:
    info["timeline"] = {
        "name": tl.GetName(),
        "fps": _fps(),
        "startFrame": tl.GetStartFrame(),
        "endFrame": tl.GetEndFrame(),
        "duration_tc": _tc(tl.GetEndFrame() - tl.GetStartFrame()),
        "videoTracks": tl.GetTrackCount("video"),
        "audioTracks": tl.GetTrackCount("audio"),
    }
info["timelines"] = [proj.GetTimelineByIndex(i + 1).GetName() for i in range(int(proj.GetTimelineCount()))]
_result = info
""")
    try:
        parsed = json.loads(out)
        if "error" not in parsed:
            parsed["connection_mode"] = _client.mode
            out = json.dumps(parsed, ensure_ascii=False)
    except Exception:
        pass
    return out


@mcp.tool()
def get_timeline_clips(track_type: str = "video") -> str:
    """Lista todos os clips da timeline atual por track: indice, nome, frames de inicio/fim, duracao e timecode. track_type: 'video' ou 'audio'."""
    return _run(r"""
tt = %r
tracks = {}
for t in range(1, int(tl.GetTrackCount(tt)) + 1):
    items = []
    for i, it in enumerate(tl.GetItemListInTrack(tt, t) or []):
        items.append({
            "index": i,
            "name": it.GetName(),
            "start": it.GetStart(),
            "end": it.GetEnd(),
            "start_tc": _tc(it.GetStart() - tl.GetStartFrame()),
            "end_tc": _tc(it.GetEnd() - tl.GetStartFrame()),
            "duration": it.GetDuration(),
        })
    tracks["%%s%%d" %% (tt[0].upper(), t)] = items
_result = {"timeline": tl.GetName(), "fps": _fps(), "startFrame": tl.GetStartFrame(), "tracks": tracks}
""" % track_type)


@mcp.tool()
def run_python(code: str, timeout: int = 120) -> str:
    """Executa codigo Python dentro do Resolve (escape hatch pra qualquer coisa da API).

    Disponivel no namespace: `resolve` (objeto raiz da API), `proj` (projeto atual),
    `tl` (timeline atual), `_fps()`, `_tc(frames)`, `json`.
    Setar `_result` com o valor de retorno (precisa ser JSON-serializavel; o resto vira repr).
    Ex.: _result = [m for m in dir(tl)]  # introspeccao da API
    """
    return _run(code, timeout=timeout)


@mcp.tool()
def set_clip_transform(track: int, clip_index: int, zoom: float = None, pan: float = None, tilt: float = None) -> str:
    """Aplica zoom/pan/tilt estatico num clip de video (punch-in). zoom=1.0 e o normal; pan/tilt em pixels da timeline."""
    return _run(r"""
items = tl.GetItemListInTrack("video", %d) or []
it = items[%d]
applied = {}
vals = {"ZoomX": %r, "ZoomY": %r, "Pan": %r, "Tilt": %r}
for k, v in vals.items():
    if v is not None:
        applied[k] = bool(it.SetProperty(k, float(v)))
_result = {"clip": it.GetName(), "applied": applied,
           "now": {k: it.GetProperty(k) for k in ("ZoomX", "ZoomY", "Pan", "Tilt")}}
""" % (track, clip_index, zoom, zoom, pan, tilt))


@mcp.tool()
def delete_clips(track: int, clip_indices: list, ripple: bool = True) -> str:
    """Deleta clips de video por indice (ver get_timeline_clips). ripple=True fecha o buraco (ripple delete)."""
    return _run(r"""
items = tl.GetItemListInTrack("video", %d) or []
targets = [items[i] for i in %r]
names = [t.GetName() for t in targets]
ok = tl.DeleteClips(targets, %r)
_result = {"deleted": names, "ripple": %r, "ok": bool(ok)}
""" % (track, list(clip_indices), bool(ripple), bool(ripple)))


@mcp.tool()
def add_marker(frame: int, color: str = "Blue", name: str = "", note: str = "", duration: int = 1) -> str:
    """Adiciona marker na timeline. frame e absoluto (como em get_timeline_clips). Cores: Blue, Cyan, Green, Yellow, Red, Pink, Purple, Fuchsia, Rose, Lavender, Sky, Mint, Lemon, Sand, Cocoa, Cream."""
    return _run(r"""
rel = %d - tl.GetStartFrame()
ok = tl.AddMarker(rel, %r, %r, %r, %d)
_result = {"ok": bool(ok), "frame": %d, "tc": _tc(rel)}
""" % (frame, color, name, note, duration, frame))


@mcp.tool()
def set_playhead(frame: int) -> str:
    """Move o playhead pro frame absoluto indicado."""
    return _run(r"""
ok = tl.SetCurrentTimecode(_tc(%d - tl.GetStartFrame()))
_result = {"ok": bool(ok), "timecode": tl.GetCurrentTimecode()}
""" % frame)


@mcp.tool()
def append_subclip(media_name: str, start_frame: int = None, end_frame: int = None, track: int = 1) -> str:
    """Appenda um trecho (subclip) de um clip do media pool no fim da timeline. Frames relativos ao SOURCE. Sem start/end appenda inteiro."""
    return _run(r"""
mp = proj.GetMediaPool()

def _walk(folder):
    for c in folder.GetClipList() or []:
        yield c
    for sub in folder.GetSubFolderList() or []:
        for c in _walk(sub):
            yield c

target = None
for c in _walk(mp.GetRootFolder()):
    if c.GetName() == %r:
        target = c
        break
if target is None:
    _result = {"error": "clip nao achado no media pool: %s"}
else:
    entry = {"mediaPoolItem": target, "trackIndex": %d}
    if %r is not None:
        entry["startFrame"] = %d
    if %r is not None:
        entry["endFrame"] = %d
    added = mp.AppendToTimeline([entry])
    _result = {"ok": bool(added), "added": [a.GetName() for a in (added or [])]}
""" % (media_name, media_name, track,
       start_frame, start_frame if start_frame is not None else 0,
       end_frame, end_frame if end_frame is not None else 0))


@mcp.tool()
def save_project() -> str:
    """Salva o projeto atual."""
    return _run(r"""
ok = resolve.GetProjectManager().SaveProject()
_result = {"saved": bool(ok)}
""")


if __name__ == "__main__":
    mcp.run()
