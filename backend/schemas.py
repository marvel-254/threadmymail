from datetime import datetime
from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel, EmailStr, Field
from uuid import UUID


class ResponseBase(BaseModel):
    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None


class ErrorResponse(ResponseBase):
    success: bool = False
    data: None = None


class SuccessResponse(ResponseBase):
    success: bool = True
    error: None = None


# Auth Schemas
class MagicLinkRequest(BaseModel):
    email: EmailStr


class MagicLinkResponse(SuccessResponse):
    data: Dict[str, str] = Field(default_factory=dict)


class VerifyTokenRequest(BaseModel):
    token: str


class TokenResponse(SuccessResponse):
    data: Dict[str, Any]


class UserMeResponse(SuccessResponse):
    data: Dict[str, Any]


# Email Account Schemas
class GmailOAuthUrlResponse(SuccessResponse):
    data: Dict[str, str]


class AccountCreateRequest(BaseModel):
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


class AccountUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    is_default: Optional[bool] = None
    folder_mapping: Optional[Dict[str, str]] = None
    sync_enabled: Optional[bool] = None


class AccountResponse(SuccessResponse):
    data: Dict[str, Any]


class AccountsListResponse(SuccessResponse):
    data: Dict[str, Any]


class TestConnectionResponse(SuccessResponse):
    data: Dict[str, Any]


class SyncResponse(SuccessResponse):
    data: Dict[str, Any]


# Email Schemas
class EmailListQuery(BaseModel):
    account_id: Optional[UUID] = None
    folder: str = "inbox"
    search: Optional[str] = None
    unread_only: bool = False
    flagged_only: bool = False
    page: int = 1
    page_size: int = 50
    sort_by: str = "received_at"
    sort_order: str = "desc"


class EmailListResponse(SuccessResponse):
    data: Dict[str, Any]


class EmailDetailResponse(SuccessResponse):
    data: Dict[str, Any]


class EmailHeadersResponse(SuccessResponse):
    data: Dict[str, Any]


class FlagActionResponse(SuccessResponse):
    data: Dict[str, Any]


class MoveEmailRequest(BaseModel):
    folder: str


class DraftCreateRequest(BaseModel):
    to: List[EmailStr]
    cc: Optional[List[EmailStr]] = None
    bcc: Optional[List[EmailStr]] = None
    subject: str
    body: str
    account_id: UUID


class DraftResponse(SuccessResponse):
    data: Dict[str, UUID]


class SendEmailRequest(BaseModel):
    to: List[EmailStr]
    cc: Optional[List[EmailStr]] = None
    bcc: Optional[List[EmailStr]] = None
    subject: str
    body: str
    account_id: UUID


class SendDraftRequest(BaseModel):
    draft_id: UUID


class SendEmailResponse(SuccessResponse):
    data: Dict[str, Any]


# AI Schemas
class SummarizeRequest(BaseModel):
    email_ids: List[UUID]
    max_length: str = "medium"


class SummarizeResponse(SuccessResponse):
    data: Dict[str, Any]


class ComposeRequest(BaseModel):
    action: str
    email_id: Optional[UUID] = None
    to: Optional[List[EmailStr]] = None
    subject: Optional[str] = None
    tone: str = "professional"
    length: str = "concise"
    include_actions: bool = True
    context: Optional[str] = None


class ComposeResponse(SuccessResponse):
    data: Dict[str, Any]


class TriageRequest(BaseModel):
    account_id: UUID
    limit: int = 50
    reclassify: bool = False


class TriageResponse(SuccessResponse):
    data: Dict[str, Any]


class ChatRequest(BaseModel):
    message: str
    search_limit: int = 10
    include_snippets: bool = True


class ChatResponse(SuccessResponse):
    data: Dict[str, Any]


class ExtractTasksRequest(BaseModel):
    email_id: UUID
    include_deadlines: bool = True


class ExtractTasksResponse(SuccessResponse):
    data: Dict[str, Any]


# Task Schemas
class TaskQuery(BaseModel):
    status: Optional[str] = None
    type: Optional[str] = None
    limit: int = 50


class TaskCreateRequest(BaseModel):
    type: str
    when: datetime
    payload: Dict[str, Any]
    channel: str = "both"


class TaskResponse(SuccessResponse):
    data: Dict[str, Any]


class TasksListResponse(SuccessResponse):
    data: Dict[str, Any]


class RescheduleTaskRequest(BaseModel):
    when: datetime


# Notification Schemas
class NotificationQuery(BaseModel):
    read: Optional[bool] = None
    type: Optional[str] = None
    limit: int = 100


class NotificationResponse(SuccessResponse):
    data: Dict[str, Any]


class NotificationsListResponse(SuccessResponse):
    data: Dict[str, Any]


class MarkNotificationsReadRequest(BaseModel):
    notification_ids: Optional[List[UUID]] = None
    all: bool = False


class PushTokenRequest(BaseModel):
    token: str
    device_info: Optional[Dict[str, Any]] = None


class NotificationSettingsRequest(BaseModel):
    daily_digest_time: Optional[str] = None
    daily_digest: Optional[bool] = None
    important_push: Optional[bool] = None
    low_priority_push: Optional[bool] = None
    email_digest: Optional[bool] = None
    important_emails: Optional[bool] = None


# Settings Schemas
class SettingsResponse(SuccessResponse):
    data: Dict[str, Any]


class AIConfigRequest(BaseModel):
    provider: str
    model: str
    temperature: float = 0.3
    max_tokens: int = 2000
    base_url: Optional[str] = None
    api_key: Optional[str] = None


class AIConfigResponse(SuccessResponse):
    data: Dict[str, Any]


class AppearanceSettingsRequest(BaseModel):
    theme: Optional[str] = None
    timezone: Optional[str] = None
    date_format: Optional[str] = None


class SyncSettingsRequest(BaseModel):
    auto_sync: Optional[bool] = None
    sync_interval: Optional[int] = None
    fetch_days: Optional[int] = None


# Search Schemas
class SearchQuery(BaseModel):
    q: str
    account_id: Optional[UUID] = None
    folders: Optional[str] = None
    limit: int = 20


class SearchResponse(SuccessResponse):
    data: Dict[str, Any]
