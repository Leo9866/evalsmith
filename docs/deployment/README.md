# Deployment

EvalSmith includes local Docker Compose and Kubernetes deployment assets.

## Docker Compose Trial

```sh
cp deploy/env/trial.env.example deploy/env/trial.env
make trial-up
make install-check
```

Edit `deploy/env/trial.env` before running outside local development. The example file intentionally uses placeholder secret values.

## Kubernetes

The Kubernetes manifests under `deploy/k8s/manifests` use placeholders for namespace, image registry, image tag, and secrets. Render them through the helper scripts or replace placeholders before applying directly.

```sh
deploy/k8s/build-and-push.sh
deploy/k8s/deploy.sh <image-tag>
```

Set real values for registry credentials, service tokens, database passwords, object storage credentials, and `EVALSMITH_SECRET_KEY` through Kubernetes Secrets.
