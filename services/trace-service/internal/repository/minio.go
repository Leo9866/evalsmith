package repository

import (
	"bytes"
	"context"
	"fmt"
	"io"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type MinIORepo struct {
	client *minio.Client
	bucket string
}

func NewMinIORepo(endpoint, accessKey, secretKey, bucket string, useSSL bool) (*MinIORepo, error) {
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("minio client: %w", err)
	}

	// Ensure bucket exists.
	ctx := context.Background()
	exists, err := client.BucketExists(ctx, bucket)
	if err != nil {
		return nil, fmt.Errorf("minio bucket check: %w", err)
	}
	if !exists {
		if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
			return nil, fmt.Errorf("minio make bucket: %w", err)
		}
	}

	return &MinIORepo{client: client, bucket: bucket}, nil
}

// PutPayload stores a JSON payload in MinIO under the given key.
func (r *MinIORepo) PutPayload(ctx context.Context, key string, data []byte) error {
	reader := bytes.NewReader(data)
	_, err := r.client.PutObject(ctx, r.bucket, key, reader, int64(len(data)), minio.PutObjectOptions{
		ContentType: "application/json",
	})
	if err != nil {
		return fmt.Errorf("minio put %s: %w", key, err)
	}
	return nil
}

// GetPayload retrieves a JSON payload from MinIO.
func (r *MinIORepo) GetPayload(ctx context.Context, key string) ([]byte, error) {
	obj, err := r.client.GetObject(ctx, r.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("minio get %s: %w", key, err)
	}
	defer obj.Close()

	data, err := io.ReadAll(obj)
	if err != nil {
		return nil, fmt.Errorf("minio read %s: %w", key, err)
	}
	return data, nil
}
