FROM node:22-slim

# Directory setup
RUN mkdir -p /src/packages/query /src/packages/langchain /src/packages/neo4j
WORKDIR /src

# Install node deps
COPY package.json /src/package.json
COPY package-lock.json /src/package-lock.json
COPY packages/langchain/package.json /src/packages/langchain/package.json
COPY packages/neo4j/package.json /src/packages/neo4j/package.json
COPY packages/query/package.json /src/packages/query/package.json
RUN npm ci

# Add packages.
ADD packages/langchain /src/packages/langchain
ADD packages/neo4j /src/packages/neo4j
ADD packages/query /src/packages/query

# Build package
RUN npm run build

# Run
CMD node packages/query/dist/src/index.js
