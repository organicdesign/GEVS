/* eslint-disable no-console */
import assert from 'assert/strict'
import { ChatOllama } from '@langchain/community/chat_models/ollama'
import { OllamaEmbeddings } from '@langchain/community/embeddings/ollama'
import { Chroma } from '@langchain/community/vectorstores/chroma'
import { type IterableReadableStream } from '@langchain/core/utils/stream'
import { EntityExtractor } from '@organicdesign/gvs-langchain'
import { neo4jParser } from '@organicdesign/gvs-neo4j'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import neo4j from 'neo4j-driver'
import stripTags from 'striptags'

assert(process.env.OLLAMA_TEMPERATURE)
assert(process.env.OLLAMA_DIMENTIONS)
assert(process.env.NEO4J_ADMIN_PASSWORD)

if (process.env.URL == null) {
  throw new Error('Missing URL environment variable.')
}

const model = new ChatOllama({
  baseUrl: `http://${process.env.OLLAMA_HOST}:${process.env.OLLAMA_PORT}`,
  model: process.env.OLLAMA_INFERENCE,
  temperature: Number(process.env.OLLAMA_TEMPERATURE)
})

const embeddings = new OllamaEmbeddings({
  baseUrl: `http://${process.env.OLLAMA_HOST}:${process.env.OLLAMA_PORT}`,
  model: process.env.OLLAMA_EMBEDDINGS
})

// The normal embeddings vector store.
const vectorStore = await Chroma.fromExistingCollection(
  embeddings,
  {
    url: `http://${process.env.CHROMA_HOST}:${process.env.CHROMA_PORT}`,
    collectionName: process.env.CHROMA_EMBEDDING_COLLECTION,
    collectionMetadata: { 'hnsw:space': process.env.CHROMA_SPACE },
    numDimensions: Number(process.env.OLLAMA_DIMENTIONS)
  }
)

// A separate vectorstore for the graph
const knowledgeGraphVectorStore = await Chroma.fromExistingCollection(
  embeddings,
  {
    url: `http://${process.env.CHROMA_HOST}:${process.env.CHROMA_PORT}`,
    collectionName: process.env.CHROMA_GRAPH_COLLECTION,
    collectionMetadata: { 'hnsw:space': process.env.CHROMA_SPACE },
    numDimensions: Number(process.env.OLLAMA_DIMENTIONS)
  }
)

const driver = neo4j.driver(`neo4j://${process.env.NEO4J_HOST}`, neo4j.auth.basic('neo4j', process.env.NEO4J_ADMIN_PASSWORD))

const req = await fetch(process.env.URL).then(async r => r.text())
const content = stripTags(req)
const entityExtractor = new EntityExtractor(model, process.env.URL)

const streamToIterator = async function * <T>(stream: IterableReadableStream<T[]>): AsyncGenerator<T, void, undefined> {
  for await (const items of stream) {
    yield * items
  }
}

// Embed the page like usual:
const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1024 })

for await (const chunk of await splitter.splitText(content)) {
  await vectorStore.addDocuments([{
    pageContent: chunk,
    metadata: {}
  }])
}

// Parse the page into the knowledge graph.
const graphSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 4096 })

for await (const chunk of await graphSplitter.splitText(content)) {
  const stream = await entityExtractor.stream(chunk)
  const itr = streamToIterator(stream)

  for await (const extract of neo4jParser(driver, knowledgeGraphVectorStore, itr)) {
    if (extract.is === 'entity') {
      console.log(`[entity] ${extract.properties.name}`)
    } else {
      console.log(`[relationship] ${extract.from.properties.name} -> ${extract.type} -> ${extract.to.properties.name}`)
    }
  }
}
