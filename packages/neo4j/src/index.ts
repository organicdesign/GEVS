import { z } from 'zod'
import type { VectorStoreInterface } from '@langchain/core/vectorstores'
import type { Driver } from 'neo4j-driver'

interface Entity {
  is: 'entity'
  name: string
  types: string[]
  emphasis: number
}

interface Relationship {
  is: 'relationship'
  emphasis: number
  from: string
  to: string
  type: string
}

const Neo4jNode = z.object({
  properties: z.object({
    name: z.string(),
    count: z.number().optional().default(0),
    harmonic: z.number().optional().default(0)
  }),

  labels: z.array(z.string())
})

// eslint-disable-next-line @typescript-eslint/no-redeclare
export type Neo4jNode = z.output<typeof Neo4jNode>

const Neo4jRelationship = z.object({
  properties: z.object({
    count: z.number().optional().default(0),
    harmonic: z.number().optional().default(0)
  }),

  from: Neo4jNode,
  to: Neo4jNode,
  type: z.string()
})

const VectorStoreItem = z.object({
  pageContent: z.string(),
  metadata: z.object({
    id: z.string(),
    type: z.union([z.literal('entity'), z.literal('relationship')])
  })
})

// eslint-disable-next-line @typescript-eslint/no-redeclare
export type Neo4jRelationship = z.output<typeof Neo4jRelationship>

const escape = (input: string): string => {
  const output = input.replaceAll(/[^a-z0-9 ._-]/gi, '').replaceAll(/[-. ]/gi, '_').toUpperCase()
  const startsWithNum = /^[0-9]/.test(output)

  if (startsWithNum) {
    return `_${output}`
  }

  return output
}

export const neo4jParser = async function * (driver: Driver, vectorstore: VectorStoreInterface, entityStream: AsyncIterable<Entity | Relationship>): AsyncGenerator<({ is: 'entity' } & Neo4jNode) | ({ is: 'relationship' } & Neo4jRelationship)> {
  for await (const item of entityStream) {
    const session = driver.session({ defaultAccessMode: 'WRITE' })

    const setMetadata = [
      'n.count = COALESCE(0, n.count) + 1',
      `n.harmonic = COALESCE(0, n.harmonic) + ${1 / item.emphasis}`
    ].join(', ')

    const command = ((): string[] => {
      if (item.is === 'entity') {
        return [
          `MERGE (n { name: '${escape(item.name)}' })`,
          item.types.length > 0 ? `SET n:${item.types.map(escape).join(':')}` : '',
          `SET ${setMetadata}`,
          'RETURN n',
          'LIMIT 1'
        ]
      } else {
        return [
          `MERGE (a {name: '${escape(item.from)}'})`,
          `MERGE (b {name:'${escape(item.to)}'})`,
          `MERGE (a)-[n:${escape(item.type)}]->(b)`,
          `SET ${setMetadata}`,
          'RETURN a, n, b',
          'LIMIT 1'
        ]
      }
    })().join(' ')

    const r = await session.run(command)
    const obj = r.records[0].toObject()

    await session.close()

    // Update the vectorstore.
    try {
      const name = item.is === 'entity' ? item.name : item.type

      const doc = {
        pageContent: name,
        metadata: { type: item.is, id: escape(name) }
      }

      await vectorstore.addDocuments([doc], { ids: [escape(name)] })
    } catch (error) {
      if (error instanceof Error && !error.message.startsWith('Expected IDs to be unique')) {
        throw error
      }
    }

    if (item.is === 'entity') {
      yield { is: 'entity', ...Neo4jNode.parse(obj.n) }
    } else {
      yield {
        is: 'relationship',
        ...Neo4jRelationship.parse({
          from: obj.a,
          to: obj.b,
          ...obj.n
        })
      }
    }
  }
}

const getRelationships = async (driver: Driver, name: string): Promise<Neo4jRelationship[]> => {
  const session = driver.session({ defaultAccessMode: 'READ' })

  const r = await session.run(`MATCH (a { name: "${name}" })-[n]-(b) RETURN a, n, b;`)

  await session.close()

  return r.records.map(r => {
    const obj = r.toObject()

    if (obj.a.identity !== obj.n.start) {
      [obj.a, obj.b] = [obj.b, obj.a]
    }

    return Neo4jRelationship.parse({
      from: obj.a,
      to: obj.b,
      ...obj.n
    })
  })
}

export const sortRelationships = (a: Neo4jRelationship, b: Neo4jRelationship): number => {
  const aHarmonics = [a.from, a, a.to].map(k => Number(k.properties.count) / Number(k.properties.harmonic))
  const bHarmonics = [b.from, b, b.to].map(k => Number(k.properties.count) / Number(k.properties.harmonic))

  const aHarmonic = aHarmonics.reduce((a, c) => a + c, 0) / 3
  const bHarmonic = bHarmonics.reduce((a, c) => a + c, 0) / 3

  return bHarmonic - aHarmonic
}

export const neo4jReader = async function * (driver: Driver, vectorstore: VectorStoreInterface, entityStream: AsyncIterable<Entity | Relationship>, options: Partial<{ limit: number }> = {}): AsyncGenerator<Neo4jRelationship[], void, undefined> {
  for await (const item of entityStream) {
    if (item.is === 'relationship') {
      continue
    }

    const vectorstoreResults = await vectorstore.similaritySearch(item.name, 5)

    const parsedResults = vectorstoreResults
      .map(r => VectorStoreItem.parse(r))
      .filter(r => r.metadata.type === 'entity')

    const relationships = await Promise.all(parsedResults.map(async r => getRelationships(driver, r.metadata.id)))

    yield relationships
      .reduce((a, c) => [...a, ...c], [])
      .sort(sortRelationships)
      .slice(0, options.limit ?? 10)
  }
}
