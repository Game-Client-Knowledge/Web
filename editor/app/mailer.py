from __future__ import annotations

import smtplib
from email.message import EmailMessage

from .smtp_config import SmtpConfiguration


def send_email(
    settings: SmtpConfiguration,
    recipients: list[str],
    subject: str,
    body: str,
    html_body: str | None = None,
) -> tuple[str, str | None]:
    if not settings.smtp_enabled:
        return "unconfigured", "SMTP 尚未配置"
    if not recipients:
        return "failed", "没有可用的管理员邮箱"

    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = ", ".join(recipients)
    message["Subject"] = subject
    message.set_content(body)
    if html_body:
        message.add_alternative(html_body, subtype="html")

    _debug_stage = "connect"
    # #region debug-point A:smtp-config
    exec("try:\n import hashlib,json,urllib.request\n _domain=settings.smtp_username.rsplit('@',1)[-1] if '@' in settings.smtp_username else ''\n urllib.request.urlopen(urllib.request.Request('http://192.168.31.10:7777/event',data=json.dumps({'sessionId':'smtp-test-502','runId':'post-fix','hypothesisId':'A','location':'mailer.py:send_email','msg':'[DEBUG] SMTP configuration loaded','data':{'provider':settings.provider,'host':settings.smtp_host,'port':settings.smtp_port,'starttls':settings.smtp_starttls,'usernameDomain':_domain,'usernameMatchesFrom':settings.smtp_username.lower()==settings.smtp_from.lower(),'hasUsername':bool(settings.smtp_username),'hasPassword':bool(settings.smtp_password),'recipientCount':len(recipients)},'ts':int(__import__('time').time()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
    # #endregion
    try:
        with smtplib.SMTP(
            settings.smtp_host,
            settings.smtp_port,
            timeout=15,
        ) as client:
            if settings.smtp_starttls:
                _debug_stage = "starttls"
                client.starttls()
                # #region debug-point B:starttls
                exec("try:\n import json,urllib.request\n urllib.request.urlopen(urllib.request.Request('http://192.168.31.10:7777/event',data=json.dumps({'sessionId':'smtp-test-502','runId':'post-fix','hypothesisId':'B','location':'mailer.py:starttls','msg':'[DEBUG] SMTP STARTTLS established','data':{'host':settings.smtp_host,'port':settings.smtp_port},'ts':int(__import__('time').time()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
                # #endregion
            if settings.smtp_username:
                _debug_stage = "login"
                if settings.provider == "qq":
                    client.user = settings.smtp_username
                    client.password = settings.smtp_password
                    client.auth(
                        "LOGIN",
                        client.auth_login,
                        initial_response_ok=False,
                    )
                else:
                    client.login(
                        settings.smtp_username,
                        settings.smtp_password,
                    )
                # #region debug-point C:login
                exec("try:\n import json,urllib.request\n urllib.request.urlopen(urllib.request.Request('http://192.168.31.10:7777/event',data=json.dumps({'sessionId':'smtp-test-502','runId':'post-fix','hypothesisId':'C','location':'mailer.py:login','msg':'[DEBUG] SMTP authentication accepted','data':{'usernameDomain':settings.smtp_username.rsplit('@',1)[-1] if '@' in settings.smtp_username else ''},'ts':int(__import__('time').time()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
                # #endregion
            _debug_stage = "send"
            client.send_message(message)
            # #region debug-point D:send
            exec("try:\n import json,urllib.request\n urllib.request.urlopen(urllib.request.Request('http://192.168.31.10:7777/event',data=json.dumps({'sessionId':'smtp-test-502','runId':'post-fix','hypothesisId':'D','location':'mailer.py:send_message','msg':'[DEBUG] SMTP message accepted','data':{'recipientCount':len(recipients)},'ts':int(__import__('time').time()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
            # #endregion
        return "sent", None
    except Exception as exc:
        # #region debug-point E:smtp-error
        exec("try:\n import json,urllib.request\n _smtp_error=getattr(exc,'smtp_error','')\n _smtp_error=_smtp_error.decode('utf-8','replace') if isinstance(_smtp_error,bytes) else str(_smtp_error)\n urllib.request.urlopen(urllib.request.Request('http://192.168.31.10:7777/event',data=json.dumps({'sessionId':'smtp-test-502','runId':'post-fix','hypothesisId':'E','location':'mailer.py:except','msg':'[DEBUG] SMTP operation failed','data':{'stage':_debug_stage,'errorType':type(exc).__name__,'smtpCode':getattr(exc,'smtp_code',None),'smtpError':_smtp_error[:300],'message':str(exc)[:300]},'ts':int(__import__('time').time()*1000)}).encode(),headers={'Content-Type':'application/json'}),timeout=.5).read()\nexcept Exception:\n pass")
        # #endregion
        if isinstance(exc, smtplib.SMTPAuthenticationError):
            return (
                "failed",
                "SMTP 认证失败：请确认邮箱已开启 SMTP 服务，"
                "账号与授权码匹配，并避免短时间重复测试",
            )
        return "failed", str(exc)[:500]
