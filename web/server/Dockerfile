# ht6-server on Cloud Run. Owned by deploy worker — server code untouched.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# start.js runs the hub; with SIM=1 it also runs sim.js in-process as the fake robot
CMD ["node", "start.js"]
