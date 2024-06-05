/* eslint-disable no-console */
import { ChatOllama } from '@langchain/community/chat_models/ollama'
import { OllamaEmbeddings } from '@langchain/community/embeddings/ollama'
import { Chroma } from '@langchain/community/vectorstores/chroma'
import { type IterableReadableStream } from '@langchain/core/utils/stream'
import { EntityExtractor } from '@organicdesign/gvs-langchain'
import { neo4jParser } from '@organicdesign/gvs-neo4j'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import neo4j from 'neo4j-driver'

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

const page = 'Prompt_engineering'

const req = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&page=${page}&format=json`).then(async r => r.json())

const content = req.parse.wikitext['*']

const entityExtractor = new EntityExtractor(model, page)

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
