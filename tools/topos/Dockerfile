# Development-only Linux runner; release checksum from Krv-Labs/topos v0.14.0.
FROM ubuntu:24.04
ADD --chmod=755 --checksum=sha256:f509d9a6137b651f1b7e015b4b92bee34e9d176cd27d643e54c13cffd4cc3977 \
    https://github.com/Krv-Labs/topos/releases/download/v0.14.0/topos-linux-amd64 /usr/local/bin/topos
ENV TOPOS_NO_UPDATE_NOTICES=1
WORKDIR /workspace
ENTRYPOINT ["topos"]
