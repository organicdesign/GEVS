import { z } from 'zod'
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

export const neo4jParser = async function * (driver: Driver, entityStream: AsyncIterable<Entity | Relationship>): AsyncGenerator<Neo4jNode | Neo4jRelationship> {
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

    if (item.is === 'entity') {
      yield Neo4jNode.parse(obj.n)
    } else {
      yield Neo4jRelationship.parse({
        from: obj.a,
        to: obj.b,
        ...obj.n
      })
    }
  }
}
