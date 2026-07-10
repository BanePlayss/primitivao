# primitivao_bridge.py — ponte de scripting do Primitivão pro DaVinci Resolve.
#
# RODA DENTRO DO RESOLVE: Workspace > Scripts > primitivao_bridge
#
# A versao free do Resolve bloqueia scripting externo (Studio-only), mas
# permite scripts internos. Este script abre um mini-servidor TCP local
# (SO 127.0.0.1, nunca exposto pra rede) dentro do processo do Resolve,
# com acesso ao objeto `resolve` da API. O servidor MCP (tools/davinci-mcp)
# conversa com ele em JSON por linha.
#
# Protocolo (1 request JSON por linha, 1 response JSON por linha):
#   {"id": 1, "op": "ping"}
#   {"id": 2, "op": "exec", "code": "<python>"}   -> code seta `_result`
#   {"id": 3, "op": "shutdown"}
# Response: {"id": 1, "ok": true, "result": ..., "stdout": "..."}
#           {"id": 1, "ok": false, "error": "<traceback>"}

import io
import json
import socket
import sys
import threading
import traceback
import types

HOST = "127.0.0.1"
PORT = 51999

# namespace persistente entre execs (da pra guardar variaveis entre comandos)
_NS = {}


def _get_resolve():
    r = globals().get("resolve")
    if r is not None:
        return r
    try:
        import DaVinciResolveScript as dvr  # fallback se rodar por fora
        return dvr.scriptapp("Resolve")
    except Exception:
        return None


def _already_running():
    try:
        probe = socket.create_connection((HOST, PORT), timeout=1)
        probe.sendall(b'{"id": 0, "op": "ping"}\n')
        probe.close()
        return True
    except Exception:
        return False


def _handle_request(req):
    op = req.get("op", "exec")
    rid = req.get("id")

    if op == "ping":
        r = _NS.get("resolve")
        proj = None
        try:
            proj = r.GetProjectManager().GetCurrentProject().GetName()
        except Exception:
            pass
        return {"id": rid, "ok": True, "result": {"pong": True, "project": proj}}

    if op == "shutdown":
        return {"id": rid, "ok": True, "result": "bye", "_shutdown": True}

    if op == "exec":
        code = req.get("code", "")
        _NS.pop("_result", None)
        old_stdout = sys.stdout
        buf = io.StringIO()
        try:
            sys.stdout = buf
            exec(compile(code, "<bridge>", "exec"), _NS)
            result = _NS.pop("_result", None)
            return {
                "id": rid,
                "ok": True,
                "result": json.loads(json.dumps(result, default=repr)),
                "stdout": buf.getvalue(),
            }
        except Exception:
            return {
                "id": rid,
                "ok": False,
                "error": traceback.format_exc(),
                "stdout": buf.getvalue(),
            }
        finally:
            sys.stdout = old_stdout

    return {"id": rid, "ok": False, "error": "op desconhecida: %r" % op}


def _handle_conn(conn):
    conn.settimeout(600)
    f = conn.makefile("rwb")
    try:
        line = f.readline()
        if not line:
            return False
        try:
            req = json.loads(line.decode("utf-8"))
        except Exception:
            resp = {"id": None, "ok": False, "error": "JSON invalido"}
        else:
            resp = _handle_request(req)
        shutdown = resp.pop("_shutdown", False)
        f.write((json.dumps(resp, default=repr) + "\n").encode("utf-8"))
        f.flush()
        return shutdown
    finally:
        f.close()
        conn.close()


def _serve(srv):
    while True:
        try:
            conn, _addr = srv.accept()
        except OSError:
            break
        try:
            if _handle_conn(conn):
                break
        except Exception:
            traceback.print_exc()
    try:
        srv.close()
    except Exception:
        pass
    print("[primitivao_bridge] servidor encerrado.")


def main():
    if _already_running():
        print("[primitivao_bridge] ja tem uma ponte rodando na porta %d. Nada a fazer." % PORT)
        return

    r = _get_resolve()
    if r is None:
        print("[primitivao_bridge] ERRO: nao achei o objeto `resolve`. Roda este script pelo menu Workspace > Scripts dentro do DaVinci Resolve.")
        return

    _NS.clear()
    _NS.update({"resolve": r, "json": json})

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((HOST, PORT))
    srv.listen(2)

    t = threading.Thread(target=_serve, args=(srv,), daemon=True, name="primitivao_bridge")
    t.start()

    # segura referencias num modulo fake pro thread sobreviver ao fim do script
    keep = sys.modules.setdefault(
        "_primitivao_bridge_keepalive", types.ModuleType("_primitivao_bridge_keepalive")
    )
    keep.thread = t
    keep.server = srv
    keep.ns = _NS

    proj = None
    try:
        proj = r.GetProjectManager().GetCurrentProject().GetName()
    except Exception:
        pass
    print("[primitivao_bridge] ponte no ar em %s:%d - projeto: %s" % (HOST, PORT, proj))


main()
