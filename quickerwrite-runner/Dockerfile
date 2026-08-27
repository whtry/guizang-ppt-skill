FROM node:22-bookworm-slim
WORKDIR /opt/guizang-ppt-skill
COPY . .
RUN mkdir -p /data && chown -R node:node /data /opt/guizang-ppt-skill
ENV QW_RUNNER_HOST=0.0.0.0 QW_RUNNER_PORT=8080 QW_RUNNER_OUTPUT_DIR=/data
VOLUME ["/data"]
EXPOSE 8080
USER node
CMD ["node", "quickerwrite-runner/server.mjs"]
