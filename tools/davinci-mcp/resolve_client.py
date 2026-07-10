# resolve_client.py — cliente unificado pra falar com o DaVinci Resolve.
#
# Dois modos, tentados nessa ordem:
#   1. "direct" — API de scripting externa (so funciona no Resolve Studio
#      com Preferences > System > General > External scripting = Local).
#   2. "bridge" — TCP local pra ponte primitivao_bridge.py rodando DENTRO
#      do Resolve (funciona na versao free; Workspace > Scripts).
#
# Interface unica: client.run(code) executa python com `resolve` no
# namespace; o code seta `_result` pra devolver dados (JSON-serializavel;
# o que nao for vira repr()).

import json
import os
import socket
import sys

BRIDGE_HOST = "127.0.0.1"
BRIDGE_PORT = int(os.environ.get("PRIMITIVAO_BRIDGE_PORT", "51999"))

RESOLVE_SCRIPT_API = r"C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting"
RESOLVE_SCRIPT_LIB = r"C:\Program Files\Blackmagic Design\DaVinci Resolve\fusionscript.dll"


class ResolveError(RuntimeError):
    pass


class ResolveClient:
    def __init__(self):
        self.mode = None
        self._ns = None  # namespace persistente do modo direct

    # ── conexao ────────────────────────────────────────────────

    def connect(self):
        if self.mode:
            return self.mode
        if self._try_direct():
            self.mode = "direct"
        elif self._ping_bridge():
            self.mode = "bridge"
        else:
            raise ResolveError(
                "Nao consegui falar com o DaVinci Resolve.\n"
                "- Confere se o Resolve ta aberto.\n"
                "- Versao free: roda Workspace > Scripts > primitivao_bridge dentro do Resolve.\n"
                "- Versao Studio: habilita Preferences > System > General > External scripting using = Local."
            )
        return self.mode

    def _try_direct(self):
        os.environ.setdefault("RESOLVE_SCRIPT_API", RESOLVE_SCRIPT_API)
        os.environ.setdefault("RESOLVE_SCRIPT_LIB", RESOLVE_SCRIPT_LIB)
        mod_dir = os.path.join(os.environ["RESOLVE_SCRIPT_API"], "Modules")
        if mod_dir not in sys.path:
            sys.path.insert(0, mod_dir)
        try:
            import DaVinciResolveScript as dvr
            r = dvr.scriptapp("Resolve")
            if r is None:
                return False
            self._ns = {"resolve": r, "json": json}
            return True
        except Exception:
            return False

    def _bridge_call(self, payload, timeout=120):
        conn = socket.create_connection((BRIDGE_HOST, BRIDGE_PORT), timeout=timeout)
        try:
            f = conn.makefile("rwb")
            f.write((json.dumps(payload) + "\n").encode("utf-8"))
            f.flush()
            line = f.readline()
            if not line:
                raise ResolveError("Ponte fechou a conexao sem responder.")
            return json.loads(line.decode("utf-8"))
        finally:
            conn.close()

    def _ping_bridge(self):
        try:
            resp = self._bridge_call({"id": 0, "op": "ping"}, timeout=3)
            return bool(resp.get("ok"))
        except Exception:
            return False

    # ── execucao ───────────────────────────────────────────────

    def run(self, code, timeout=120):
        """Executa `code` com `resolve` disponivel; devolve o valor de `_result`."""
        self.connect()
        if self.mode == "direct":
            self._ns.pop("_result", None)
            exec(compile(code, "<direct>", "exec"), self._ns)
            result = self._ns.pop("_result", None)
            return json.loads(json.dumps(result, default=repr))
        resp = self._bridge_call({"id": 1, "op": "exec", "code": code}, timeout=timeout)
        if not resp.get("ok"):
            raise ResolveError(resp.get("error", "erro desconhecido na ponte"))
        return resp.get("result")


# snippet compartilhado: helpers que os comandos usam la dentro
PRELUDE = r"""
proj = resolve.GetProjectManager().GetCurrentProject()
tl = proj.GetCurrentTimeline()

def _fps():
    try:
        return float(tl.GetSetting("timelineFrameRate"))
    except Exception:
        return 30.0

def _tc(frames):
    fps = _fps()
    fi = int(round(fps))
    f = int(frames)
    return "%02d:%02d:%02d:%02d" % (f // (3600 * fi), (f // (60 * fi)) % 60, (f // fi) % 60, f % fi)
"""


if __name__ == "__main__":
    # teste rapido: python resolve_client.py
    c = ResolveClient()
    mode = c.connect()
    info = c.run(PRELUDE + r"""
_result = {
    "project": proj.GetName(),
    "timeline": tl.GetName() if tl else None,
    "fps": _fps() if tl else None,
}
""")
    print("modo:", mode)
    print(json.dumps(info, indent=2, ensure_ascii=False))
