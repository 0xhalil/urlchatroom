from __future__ import annotations

import smtplib
from email.message import EmailMessage

from fastapi import HTTPException, status

from app.config import settings


def _smtp_not_configured() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="smtp is not configured",
    )


def send_magic_link_email(*, to_email: str, magic_link_url: str, expires_minutes: int) -> None:
    if not settings.smtp_host or not settings.smtp_from_email:
        raise _smtp_not_configured()

    msg = EmailMessage()
    msg["Subject"] = "Your URLChatroom sign-in link"
    msg["From"] = settings.smtp_from_email
    msg["To"] = to_email
    msg.set_content(
        "\n".join(
            [
                "Use the link below to sign in to URLChatroom:",
                magic_link_url,
                "",
                f"This link expires in {expires_minutes} minutes.",
                "If you did not request this, you can ignore this email.",
            ]
        )
    )

    try:
        if settings.smtp_use_ssl:
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
                if settings.smtp_username:
                    smtp.login(settings.smtp_username, settings.smtp_password)
                smtp.send_message(msg)
            return

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(msg)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="failed to send magic link email",
        ) from exc
