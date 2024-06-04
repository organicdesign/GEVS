import { type BaseMessage } from '@langchain/core/messages'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { type ChatPromptValue } from '@langchain/core/prompt_values'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { Runnable } from '@langchain/core/runnables'
import { IterableReadableStream } from '@langchain/core/utils/stream'
import { z } from 'zod'

export const entityExtractionTemplate = `You are a graph specialist, you find named enities in the given text and their relationships. You ignore entities that are too general to be useful in a graph.

Provide your output in newline delimited JSON object stream like this:

{format}

Be sure to throughly check the content for entities and relationships.
Ensure all relationships have defined entities.

For each entity add a emphasis value (0-10) of strongly the content emphasizes to it.
For each relationship add a emphasize value (0-10) of how strongly the relationship is emphasized in the content.

Only provide the new line delimited JSON output and be sure to generate valid JSON objects in the JSON stream.
Do NOT prefix the output with plaintext.

<content source="{source}">
{input}
</content>

Output:
`

const exampleEntityFormat: Entity = {
  is: 'entity',
  name: 'entity name',
  types: ['instance type', '...'],
  emphasis: 9
}

const exampleRelationshipFormat: Relationship = {
  is: 'relationship',
  from: 'entity name',
  to: 'entity name',
  type: 'relationship type',
  emphasis: 5
}

const exampleFormat = [
  exampleEntityFormat,
  exampleRelationshipFormat
].map(o => JSON.stringify(o)).join('\n')

export const Entity = z.object({
  is: z.literal('entity'),
  name: z.string(),
  types: z.array(z.string()),
  emphasis: z.number().min(0).max(10).transform(n => n / 10)
})

// eslint-disable-next-line @typescript-eslint/no-redeclare
export type Entity = z.infer<typeof Entity>

export const Relationship = z.object({
  is: z.literal('relationship'),
  emphasis: z.number().min(0).max(10).transform(n => n / 10),
  from: z.string(),
  to: z.string(),
  type: z.string()
})

// eslint-disable-next-line @typescript-eslint/no-redeclare
export type Relationship = z.infer<typeof Relationship>

export const GraphData = z.union([Entity, Relationship])

// eslint-disable-next-line @typescript-eslint/no-redeclare
export type GraphData = z.infer<typeof GraphData>

export const entityExtractionPrompt = ChatPromptTemplate.fromMessages([
  ['human', entityExtractionTemplate]
])

export class EntityExtractor extends Runnable<string, GraphData[]> {
  static lc_name (): string {
    return 'EntityExtractor'
  }

  lc_namespace = ['graph-vector-store', 'runnables']

  readonly events = new EventTarget()
  private readonly model: Runnable<ChatPromptValue, BaseMessage>
  private readonly source: string

  constructor (model: Runnable<ChatPromptValue, BaseMessage>, source = 'unknown') {
    super()
    this.model = model
    this.source = source
  }

  async invoke (input: string): Promise<GraphData[]> {
    const output = await entityExtractionPrompt
      .pipe(this.model)
      .pipe(new StringOutputParser())
      .invoke({ input, format: exampleFormat, source: this.source })

    return output.split('\n').map(s => {
      try {
        return this.parseObject(s)
      } catch (error) {
        this.emitStreamError(s, error)
        return null
      }
    }).filter(n => n != null) as GraphData[]
  }

  async stream (input: string): Promise<IterableReadableStream<GraphData[]>> {
    const stream = await entityExtractionPrompt
      .pipe(this.model)
      .stream({ input, format: exampleFormat, source: this.source })

    const that = this

    return IterableReadableStream.fromAsyncGenerator((async function * (): AsyncGenerator<GraphData[]> {
      let output = ''

      for await (const t of stream) {
        output += t.content.toString()

        const parts = output.split('\n').map(p => p.trim())

        if (parts.length <= 1) {
          continue
        }

        output = parts.pop() ?? ''

        for (const part of parts) {
          // Ignore witespace.
          if (part.length === 0) {
            continue
          }

          try {
            yield [that.parseObject(part)]
          } catch (error) {
            that.emitStreamError(part, error)
          }
        }
      }

      if (output.trim().length > 0) {
        try {
          yield [that.parseObject(output)]
        } catch (error) {
          that.emitStreamError(output, error)
        }
      }
    })())
  }

  private parseObject (input: string): GraphData {
    const json = ((): unknown => {
      try {
        return JSON.parse(input)
      } catch (error) {
        // Sometimes the model likes to add an extra '}'
        return JSON.parse(input.slice(0, -1))
      }
    })()

    return GraphData.parse(json)
  }

  private emitStreamError (line: string, error: unknown): void {
    this.events.dispatchEvent(new CustomEvent('stream-error', { detail: { line, error } }))
  }
}
