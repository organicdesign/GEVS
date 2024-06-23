/* eslint-disable no-console */
import { ChatOllama } from '@langchain/community/chat_models/ollama'
import { OllamaEmbeddings } from '@langchain/community/embeddings/ollama'
import { Chroma } from '@langchain/community/vectorstores/chroma'
import { type IterableReadableStream } from '@langchain/core/utils/stream'
import { EntityExtractor, ParagraphGenerator, Query } from '@organicdesign/gvs-langchain'
import { neo4jReader } from '@organicdesign/gvs-neo4j'
import neo4j from 'neo4j-driver'
import { collect, merge, take } from 'streaming-iterables'
import assert from 'assert/strict'

assert(process.env.OLLAMA_TEMPERATURE)
assert(process.env.OLLAMA_DIMENTIONS)
assert(process.env.NEO4J_ADMIN_PASSWORD)

if (process.env.QUERY == null) {
  throw new Error('Missing QUERY environment variable.')
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

const entityExtractor = new EntityExtractor(model)
const paragraphGenerator = new ParagraphGenerator(model)
const query = new Query(model)

const streamToIterator = async function * <T>(stream: IterableReadableStream<T[]>): AsyncGenerator<T, void, undefined> {
  for await (const items of stream) {
    yield * items
  }
}

// Extract the entities from the query
const stream = await entityExtractor.stream(process.env.QUERY)
const itr = streamToIterator(stream)

const extractLists = await collect(neo4jReader(driver, knowledgeGraphVectorStore, itr))

// Flatten, taking only 20 of all the entities evenly.
const extracts = await collect(take(20, merge(...extractLists)))

// Simplify the relationships for the next part.
const relationships = extracts.map(e => ({
  from: e.from.properties.name,
  to: e.to.properties.name,
  type: e.type
}))

const paragraph = await paragraphGenerator.invoke(relationships)

const documents = await vectorStore.similaritySearch(paragraph, 16)

// Get the model to answer the query with the document and relationship info.
const output = await query.invoke({ documents, relationships })

console.log(output)

await driver.close()
