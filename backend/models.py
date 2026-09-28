from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, EmailStr, Field
from uuid import UUID


class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None


class UserCreate(UserBase):
    pass


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    theme: Optional[str] = None
    timezone: Optional[str] = None
    ai_config: Optional[Dict[str, Any]] = None
    notification_settings: Optional[Dict[str, Any]] = None


class UserInDB(UserBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    ai_config: Dict[str, Any] = {}
    notification_settings: Dict[str, Any] = {}
    theme: str = "system"
    timezone: str = "UTC"

    class Config:
        from_attributes = True


class User(UserInDB):
    pass


class EmailAccountBase(BaseModel):
    provider: str
    email_address: EmailStr
    display_name: Optional[str] = None
    imap_host: Optional[str] = None
    imap_port: int = 993
    imap_username: Optional[str] = None
    imap_password: Optional[str] = None
    smtp_host: Optional[str] = None
    smtp_port: int = 587
    smtp_username: Optional[str] = None
    smtp_password: Optional[str] = None
    is_default: bool = False
    folder_mapping: Dict[str, str] = Field(default_factory=dict)


class EmailAccountCreate(EmailAccountBase):
    pass


class EmailAccountUpdate(BaseModel):
    display_name: Optional[str] = None
    is_default: Optional[bool] = None
    folder_mapping: Optional[Dict[str, str]] = None
    sync_enabled: Optional[bool] = None


class EmailAccountInDB(EmailAccountBase):
    id: UUID
    user_id: UUID
    imap_username_encrypted: Optional[str] = None
    imap_password_encrypted: Optional[str] = None
    smtp_username_encrypted: Optional[str] = None
    smtp_password_encrypted: Optional[str] = None
    sync_enabled: bool = True
    last_synced_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EmailAccount(EmailAccountBase):
    id: UUID
    user_id: UUID
    is_default: bool
    sync_enabled: bool
    last_synced_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EmailMessageBase(BaseModel):
    account_id: UUID
    message_id: Optional[str] = None
    thread_id: Optional[str] = None
    subject: Optional[str] = None
    from_address: Optional[str] = None
    from_name: Optional[str] = None
    to_addresses: List[Dict[str, str]] = Field(default_factory=list)
    cc_addresses: List[Dict[str, str]] = Field(default_factory=list)
    body_text: Optional[str] = None
    body_html: Optional[str] = None
    snippet: Optional[str] = None
    folder: str = "INBOX"
    flags: int = 0
    received_at: datetime
    ai_summary: Optional[str] = None
    ai_category: Optional[str] = None
    ai_priority: int = 0


class EmailMessageCreate(EmailMessageBase):
    pass


class EmailMessageUpdate(BaseModel):
    folder: Optional[str] = None
    flags: Optional[int] = None
    ai_summary: Optional[str] = None
    ai_category: Optional[str] = None
    ai_priority: Optional[int] = None


class EmailMessageInDB(EmailMessageBase):
    id: UUID
    synced_at: datetime

    class Config:
        from_attributes = True


class EmailMessage(EmailMessageBase):
    id: UUID
    synced_at: datetime

    class Config:
        from_attributes = True


class EmailMessageDetail(EmailMessage):
    date: Optional[str] = None
    date_parsed: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    has_attachments: bool = False
    attachments: List[Dict[str, Any]] = Field(default_factory=list)
    action_items: List[str] = Field(default_factory=list)


class EmailHeaders(BaseModel):
    headers: List[Dict[str, str]]


class AITaskBase(BaseModel):
    task_type: str
    input_data: Dict[str, Any] = Field(default_factory=dict)
    scheduled_at: datetime


class AITaskCreate(AITaskBase):
    pass


class AITaskInDB(AITaskBase):
    id: UUID
    user_id: UUID
    task_status: str = "pending"
    result_data: Optional[Dict[str, Any]] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class AITask(AITaskBase):
    id: UUID
    user_id: UUID
    task_status: str
    result_data: Optional[Dict[str, Any]] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class NotificationBase(BaseModel):
    type: str
    title: str
    body: str
    data: Optional[Dict[str, Any]] = None


class NotificationCreate(NotificationBase):
    pass


class NotificationInDB(NotificationBase):
    id: UUID
    user_id: UUID
    read: bool = False
    sent_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class Notification(NotificationBase):
    id: UUID
    user_id: UUID
    read: bool
    sent_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class PushTokenCreate(BaseModel):
    token: str
    device_info: Optional[Dict[str, Any]] = None


class SyncStatus(BaseModel):
    status: str
    estimated_completion: Optional[datetime] = None


class TestConnectionResult(BaseModel):
    test_result: str
    imap: Optional[Dict[str, Any]] = None
    smtp: Optional[Dict[str, Any]] = None
