import email
from email import policy
from email.header import decode_header, make_header
from email.utils import parseaddr, parsedate_to_datetime
from typing import List, Dict, Optional, Tuple
import re
import quopri
import base64


def decode_email_header(header: str) -> str:
    if not header:
        return ""
    try:
        return str(make_header(decode_header(header)))
    except Exception:
        return header


def parse_email_address(addr: str) -> Tuple[str, str]:
    name, email_addr = parseaddr(addr)
    name = decode_email_header(name) if name else ""
    return name, email_addr


def parse_address_list(header: str) -> List[Dict[str, str]]:
    if not header:
        return []
    addresses = []
    for addr in header.split(","):
        name, email_addr = parse_email_address(addr.strip())
        if email_addr:
            addresses.append({"name": name, "email": email_addr})
    return addresses


def get_email_body(msg: email.message.EmailMessage) -> Tuple[str, str]:
    text_body = ""
    html_body = ""
    
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition", ""))
            
            if "attachment" in content_disposition:
                continue
                
            payload = part.get_payload(decode=True)
            if not payload:
                continue
                
            charset = part.get_content_charset() or "utf-8"
            try:
                decoded = payload.decode(charset, errors="replace")
            except Exception:
                decoded = payload.decode("utf-8", errors="replace")
            
            if content_type == "text/plain":
                text_body += decoded
            elif content_type == "text/html":
                html_body += decoded
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            try:
                decoded = payload.decode(charset, errors="replace")
            except Exception:
                decoded = payload.decode("utf-8", errors="replace")
            
            if msg.get_content_type() == "text/html":
                html_body = decoded
            else:
                text_body = decoded
    
    return text_body.strip(), html_body.strip()


def generate_snippet(text: str, max_length: int = 200) -> str:
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text.strip())
    if len(text) <= max_length:
        return text
    return text[:max_length].rsplit(" ", 1)[0] + "..."


def extract_attachments(msg: email.message.EmailMessage) -> List[Dict]:
    attachments = []
    if msg.is_multipart():
        for part in msg.walk():
            content_disposition = str(part.get("Content-Disposition", ""))
            if "attachment" not in content_disposition:
                continue
            
            filename = part.get_filename()
            if filename:
                filename = decode_email_header(filename)
            
            content_type = part.get_content_type()
            payload = part.get_payload(decode=True)
            size = len(payload) if payload else 0
            
            attachments.append({
                "filename": filename,
                "mime_type": content_type,
                "size": size
            })
    return attachments


def parse_email_message(raw_email: bytes) -> Dict:
    msg = email.message_from_bytes(raw_email, policy=policy.default)
    
    subject = decode_email_header(msg.get("Subject", ""))
    from_header = msg.get("From", "")
    from_name, from_address = parse_email_address(from_header)
    
    to_addresses = parse_address_list(msg.get("To", ""))
    cc_addresses = parse_address_list(msg.get("Cc", ""))
    bcc_addresses = parse_address_list(msg.get("Bcc", ""))
    
    date_header = msg.get("Date", "")
    try:
        received_at = parsedate_to_datetime(date_header)
    except Exception:
        received_at = None
    
    message_id = msg.get("Message-ID", "").strip("<>")
    thread_id = msg.get("Thread-Index", msg.get("In-Reply-To", "")).strip("<>")
    
    body_text, body_html = get_email_body(msg)
    snippet = generate_snippet(body_text or body_html)
    attachments = extract_attachments(msg)
    
    return {
        "message_id": message_id,
        "thread_id": thread_id,
        "subject": subject,
        "from_address": from_address,
        "from_name": from_name,
        "to_addresses": to_addresses,
        "cc_addresses": cc_addresses,
        "bcc_addresses": bcc_addresses,
        "date": date_header,
        "date_parsed": received_at.isoformat() if received_at else None,
        "body_text": body_text,
        "body_html": body_html,
        "snippet": snippet,
        "has_attachments": len(attachments) > 0,
        "attachments": attachments,
        "headers": [
            {"name": k, "value": v} for k, v in msg.items()
        ]
    }


def build_mime_message(
    to: List[str],
    subject: str,
    body_text: str,
    body_html: Optional[str] = None,
    cc: Optional[List[str]] = None,
    bcc: Optional[List[str]] = None,
    from_addr: Optional[str] = None,
    in_reply_to: Optional[str] = None,
    references: Optional[str] = None
) -> email.message.EmailMessage:
    msg = email.message.EmailMessage()
    msg["Subject"] = subject
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    if from_addr:
        msg["From"] = from_addr
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references:
        msg["References"] = references
    
    if body_html:
        msg.set_content(body_text, subtype="plain")
        msg.add_alternative(body_html, subtype="html")
    else:
        msg.set_content(body_text, subtype="plain")
    
    return msg
