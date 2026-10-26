"""Checks your password with PAM, the same way COSMIC's own lock screen does.

The password is only handed to PAM (which checks it against your account) and is never
stored or written anywhere.
"""

import ctypes
import ctypes.util
import threading

PAM_PROMPT_ECHO_OFF = 1
PAM_PROMPT_ECHO_ON = 2
PAM_ERROR_MSG = 3
PAM_TEXT_INFO = 4
PAM_SUCCESS = 0
PAM_BUF_ERR = 5
PAM_CONV_ERR = 19

_lib = None
_libc = None


class PamMessage(ctypes.Structure):
    _fields_ = [("msg_style", ctypes.c_int), ("msg", ctypes.c_char_p)]


class PamResponse(ctypes.Structure):
    _fields_ = [("resp", ctypes.c_void_p), ("resp_retcode", ctypes.c_int)]


CONV_FUNC = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.POINTER(PamMessage)),
                             ctypes.POINTER(ctypes.POINTER(PamResponse)), ctypes.c_void_p)


class PamConv(ctypes.Structure):
    _fields_ = [("conv", CONV_FUNC), ("appdata_ptr", ctypes.c_void_p)]


def _load():
    global _lib, _libc
    if _lib is None:
        _lib = ctypes.CDLL(ctypes.util.find_library("pam") or "libpam.so.0")
        _libc = ctypes.CDLL(ctypes.util.find_library("c") or "libc.so.6")
        _libc.calloc.restype = ctypes.c_void_p
        _libc.calloc.argtypes = (ctypes.c_size_t, ctypes.c_size_t)
        _libc.strdup.restype = ctypes.c_void_p
        _libc.strdup.argtypes = (ctypes.c_char_p,)
        _lib.pam_start.argtypes = (ctypes.c_char_p, ctypes.c_char_p, ctypes.POINTER(PamConv), ctypes.POINTER(ctypes.c_void_p))
        _lib.pam_authenticate.argtypes = (ctypes.c_void_p, ctypes.c_int)
        _lib.pam_acct_mgmt.argtypes = (ctypes.c_void_p, ctypes.c_int)
        _lib.pam_setcred.argtypes = (ctypes.c_void_p, ctypes.c_int)
        _lib.pam_end.argtypes = (ctypes.c_void_p, ctypes.c_int)
        _lib.pam_strerror.argtypes = (ctypes.c_void_p, ctypes.c_int)
        _lib.pam_strerror.restype = ctypes.c_char_p
    return _lib


_one_at_a_time = threading.Lock()
PAM_REFRESH_CRED = 0x0010


def authenticate(username, password, service="aerie-lock"):
    """Returns (ok, message). Blocks while PAM checks (it waits a little after a wrong password)."""
    lib = _load()
    secret = password.encode("utf-8")
    messages = []

    @CONV_FUNC
    def conversation(n, msgs, resp, _data):
        # PAM frees the answers itself, so they must come from C's own allocator
        answers = _libc.calloc(n, ctypes.sizeof(PamResponse))
        if not answers:
            return PAM_BUF_ERR
        out = ctypes.cast(answers, ctypes.POINTER(PamResponse))
        for i in range(n):
            style = msgs[i].contents.msg_style
            text = (msgs[i].contents.msg or b"").decode("utf-8", "replace")
            if style == PAM_PROMPT_ECHO_OFF:
                out[i].resp = _libc.strdup(secret)
            elif style == PAM_PROMPT_ECHO_ON:
                out[i].resp = _libc.strdup(username.encode())
            elif style in (PAM_ERROR_MSG, PAM_TEXT_INFO) and text:
                messages.append(text)
            out[i].resp_retcode = 0
        resp[0] = out
        return PAM_SUCCESS

    with _one_at_a_time:
        handle = ctypes.c_void_p()
        conv = PamConv(conversation, None)
        rc = lib.pam_start(service.encode(), username.encode(), ctypes.byref(conv), ctypes.byref(handle))
        if rc != PAM_SUCCESS:
            return False, "The lock screen can't check passwords on this computer."
        rc = lib.pam_authenticate(handle, 0)
        if rc == PAM_SUCCESS:
            rc = lib.pam_acct_mgmt(handle, 0)
        if rc == PAM_SUCCESS:
            lib.pam_setcred(handle, PAM_REFRESH_CRED)  # e.g. renews a Kerberos ticket; harmless otherwise
        reason = (lib.pam_strerror(handle, rc) or b"").decode("utf-8", "replace") if rc != PAM_SUCCESS else ""
        lib.pam_end(handle, rc)
    del secret
    if rc == PAM_SUCCESS:
        return True, ""
    return False, messages[-1] if messages else ("Wrong password" if rc == 7 else reason or "Couldn't unlock")
