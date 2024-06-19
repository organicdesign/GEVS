FROM node:22-slim

# Directory setup
RUN mkdir -p /src/packages/embed-url /src/packages/langchain /src/packages/neo4j
WORKDIR /src

# Install node deps
COPY package.json /src/package.json
COPY package-lock.json /src/package-lock.json
COPY packages/langchain/package.json /src/packages/langchain/package.json
COPY packages/neo4j/package.json /src/packages/neo4j/package.json
COPY packages/embed-url/package.json /src/packages/embed-url/package.json
RUN npm ci

# Add packages.
ADD packages/langchain /src/packages/langchain
ADD packages/neo4j /src/packages/neo4j
ADD packages/embed-url /src/packages/embed-url

# Build package
RUN npm run build

# Run
CMD node packages/embed-url/dist/src/index.js
