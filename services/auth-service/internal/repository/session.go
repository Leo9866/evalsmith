package repository

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/evalsmith/auth-service/internal/model"
)

type SessionRepository struct {
	db *sql.DB
}

func NewSessionRepository(db *sql.DB) *SessionRepository {
	return &SessionRepository{db: db}
}

func (r *SessionRepository) EnsureSchema() error {
	_, err := r.db.Exec(`
		CREATE TABLE IF NOT EXISTS user_sessions (
			id            TEXT PRIMARY KEY DEFAULT 'sess_' || gen_random_uuid()::text,
			user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			token_hash    TEXT NOT NULL UNIQUE,
			expires_at    TIMESTAMPTZ NOT NULL,
			created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
			last_seen_at  TIMESTAMPTZ
		)
	`)
	if err != nil {
		return fmt.Errorf("ensure user_sessions table: %w", err)
	}
	_, err = r.db.Exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id)`)
	if err != nil {
		return fmt.Errorf("ensure user_sessions index: %w", err)
	}
	return nil
}

func (r *SessionRepository) Create(userID, tokenHash string, expiresAt time.Time) (*model.UserSession, error) {
	session := &model.UserSession{}
	err := r.db.QueryRow(
		`INSERT INTO user_sessions (user_id, token_hash, expires_at, last_seen_at)
		 VALUES ($1, $2, $3, now())
		 RETURNING id, user_id, token_hash, expires_at, created_at, last_seen_at`,
		userID, tokenHash, expiresAt,
	).Scan(&session.ID, &session.UserID, &session.TokenHash, &session.ExpiresAt, &session.CreatedAt, &session.LastSeen)
	if err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}
	return session, nil
}

func (r *SessionRepository) GetByHash(tokenHash string) (*model.UserSession, error) {
	session := &model.UserSession{}
	err := r.db.QueryRow(
		`SELECT id, user_id, token_hash, expires_at, created_at, last_seen_at
		 FROM user_sessions
		 WHERE token_hash = $1`,
		tokenHash,
	).Scan(&session.ID, &session.UserID, &session.TokenHash, &session.ExpiresAt, &session.CreatedAt, &session.LastSeen)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get session by hash: %w", err)
	}
	return session, nil
}

func (r *SessionRepository) DeleteByHash(tokenHash string) error {
	_, err := r.db.Exec(`DELETE FROM user_sessions WHERE token_hash = $1`, tokenHash)
	if err != nil {
		return fmt.Errorf("delete session by hash: %w", err)
	}
	return nil
}

func (r *SessionRepository) Touch(id string) error {
	_, err := r.db.Exec(`UPDATE user_sessions SET last_seen_at = $1 WHERE id = $2`, time.Now(), id)
	if err != nil {
		return fmt.Errorf("touch session: %w", err)
	}
	return nil
}

func (r *SessionRepository) DeleteExpired() error {
	_, err := r.db.Exec(`DELETE FROM user_sessions WHERE expires_at <= now()`)
	if err != nil {
		return fmt.Errorf("delete expired sessions: %w", err)
	}
	return nil
}
