import os
from contextlib import asynccontextmanager

import asyncpg

DB_POOL = None


async def get_db_pool():
    global DB_POOL
    if DB_POOL is None:
        DB_POOL = await asyncpg.create_pool(
            os.getenv("DATABASE_URL"), min_size=1, max_size=20, timeout=30
        )
    return DB_POOL


@asynccontextmanager
async def get_connection():
    pool = await get_db_pool()
    async with pool.acquire() as connection, connection.transaction():
        yield connection


async def init_db():
    """Initialize database with required extensions"""
    async with get_connection() as conn:
        # Enable required extensions
        await conn.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')

        # Create tables if they don't exist
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                email VARCHAR(255) UNIQUE NOT NULL,
                full_name VARCHAR(255),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                ai_config JSONB DEFAULT '{}',
                notification_settings JSONB DEFAULT '{}',
                theme VARCHAR(20) DEFAULT 'system',
                timezone VARCHAR(50) DEFAULT 'UTC'
            );
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS email_accounts (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                provider VARCHAR(50) NOT NULL,
                email_address VARCHAR(255) NOT NULL,
                display_name VARCHAR(255),
                imap_host VARCHAR(255),
                imap_port INTEGER DEFAULT 993,
                imap_username_encrypted TEXT,
                imap_password_encrypted TEXT,
                smtp_host VARCHAR(255),
                smtp_port INTEGER DEFAULT 587,
                smtp_username_encrypted TEXT,
                smtp_password_encrypted TEXT,
                is_default BOOLEAN DEFAULT FALSE,
                sync_enabled BOOLEAN DEFAULT TRUE,
                last_synced_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS email_messages (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                account_id UUID REFERENCES email_accounts(id) ON DELETE CASCADE,
                message_id VARCHAR(255) UNIQUE,
                thread_id VARCHAR(255),
                subject TEXT,
                from_address VARCHAR(255),
                from_name VARCHAR(255),
                to_addresses JSONB,
                cc_addresses JSONB,
                body_text TEXT,
                body_html TEXT,
                snippet TEXT,
                folder VARCHAR(100) DEFAULT 'INBOX',
                flags INTEGER DEFAULT 0,
                received_at TIMESTAMP NOT NULL,
                ai_summary TEXT,
                ai_category VARCHAR(50),
                ai_priority INTEGER DEFAULT 0,
                synced_at TIMESTAMP DEFAULT NOW()
            );
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_tasks (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                task_type VARCHAR(50) NOT NULL,
                task_status VARCHAR(20) DEFAULT 'pending',
                input_data JSONB,
                result_data JSONB,
                scheduled_at TIMESTAMP NOT NULL,
                started_at TIMESTAMP,
                completed_at TIMESTAMP
            );
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                type VARCHAR(20) NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                data JSONB,
                read BOOLEAN DEFAULT FALSE,
                sent_at TIMESTAMP,
                delivered_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            );
        """)

        print("Database initialized successfully")
