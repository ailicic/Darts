FROM node:20-alpine

# Run as a non-root user for security
RUN addgroup -S darts && adduser -S darts -G darts

WORKDIR /app

# Copy pre-installed production node_modules from the build context.
# Before running docker build, prune dev dependencies from the host:
#   npm install --omit=dev
COPY --chown=darts:darts node_modules ./node_modules
COPY --chown=darts:darts gameLogic.js server.js ./
COPY --chown=darts:darts public ./public

# Create the persistent data directory and ensure the darts user owns it
RUN mkdir -p /data && chown darts:darts /data

USER darts

EXPOSE 3000

# PORT can be overridden at runtime with -e PORT=xxxx
ENV PORT=3000

CMD ["node", "server.js"]
