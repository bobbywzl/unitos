# The AI gateway (SPEC.md §2): LiteLLM with this folder's config baked in.
# Build context is this folder. The host sets the environment (README.md).
FROM ghcr.io/berriai/litellm:main-stable

COPY config.yaml /app/gateway.yaml

# The image's entrypoint runs `litellm`; these are its arguments.
CMD ["--config", "/app/gateway.yaml", "--port", "4000"]
