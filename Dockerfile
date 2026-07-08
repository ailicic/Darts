FROM node:20-alpine

# Run as a non-root user for security
RUN addgroup -S darts && adduser -S darts -G darts

WORKDIR /app

# Copy pre-installed production node_modules from the build context.
# Before running docker build, prune dev dependencies from the host:
#   npm install --omit=dev
COPY --chown=darts:darts node_modules ./node_modules
<<<<<<< HEAD
COPY --chown=darts:darts gameLogic.js server.js db.js metrics.js ./
=======
COPY --chown=darts:darts gameLogic.js server.js metrics.js db.js ./
>>>>>>> origin/main
COPY --chown=darts:darts public ./public

USER darts

EXPOSE 3000

ENV PORT=3000

CMD ["node", "server.js"]
