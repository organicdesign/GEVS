/* eslint-disable no-console */
import { ChatOllama } from '@langchain/community/chat_models/ollama'
import { OllamaEmbeddings } from '@langchain/community/embeddings/ollama'
import { Chroma } from '@langchain/community/vectorstores/chroma'
import { type IterableReadableStream } from '@langchain/core/utils/stream'
import { EntityExtractor, ParagraphGenerator, Query } from '@organicdesign/gvs-langchain'
import { neo4jReader } from '@organicdesign/gvs-neo4j'
import neo4j from 'neo4j-driver'
import { collect, merge, take } from 'streaming-iterables'

const QUERY = 'What is prompt prompt engineering?'

const model = new ChatOllama({
  baseUrl: 'http://127.0.0.1:11434',
  model: 'llama3:70b-instruct'
})

const embeddings = new OllamaEmbeddings({
  baseUrl: 'http://127.0.0.1:11434',
  model: 'snowflake-arctic-embed:latest'
})

// The normal embeddings vector store.
const vectorStore = await Chroma.fromExistingCollection(
  embeddings,
  {
    url: 'http://127.0.0.1:8000',
    collectionName: 'embeddings',
    collectionMetadata: { 'hnsw:space': 'cosine' },
    numDimensions: 1024
  }
)

// A separate vectorstore for the graph
const knowledgeGraphVectorStore = await Chroma.fromExistingCollection(
  embeddings,
  {
    url: 'http://127.0.0.1:8000',
    collectionName: 'knowledge-graph',
    collectionMetadata: { 'hnsw:space': 'cosine' },
    numDimensions: 1024
  }
)

const driver = neo4j.driver('neo4j://127.0.0.1', neo4j.auth.basic('neo4j', 'neo4j'))

const entityExtractor = new EntityExtractor(model)
const paragraphGenerator = new ParagraphGenerator(model)
const query = new Query(model)

const streamToIterator = async function * <T>(stream: IterableReadableStream<T[]>): AsyncGenerator<T, void, undefined> {
  for await (const items of stream) {
    yield * items
  }
}

// Extract the entities from the query
const stream = await entityExtractor.stream(QUERY)
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
