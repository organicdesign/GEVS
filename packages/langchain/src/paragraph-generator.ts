import { type BaseMessage } from '@langchain/core/messages'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { type ChatPromptValue } from '@langchain/core/prompt_values'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { Runnable } from '@langchain/core/runnables'

export const paragraphGeneratorTemplate = `You are a knowledgeable agent who can make sense of relational data to generate a paragraph about the content:

Here are the relationship data:
<relationships>
{input}
</relationships>

You should always generate a paragraph using the relationship data, if you don't have knowledge on the topic you should make something up.

Do not prefix the paragraph with any text.
Only output the paragraph.

Output:
`

export const paragraphGeneratorPrompt = ChatPromptTemplate.fromMessages([
  ['human', paragraphGeneratorTemplate]
])

interface Relationship {
  from: string
  type: string
  to: string
}

export class ParagraphGenerator extends Runnable<Relationship[], string> {
  static lc_name (): string {
    return 'ParagraphGenerator'
  }

  lc_namespace = ['graph-vector-store', 'runnables']

  private readonly model: Runnable<ChatPromptValue, BaseMessage>

  constructor (model: Runnable<ChatPromptValue, BaseMessage>) {
    super()
    this.model = model
  }

  async invoke (input: Relationship[]): Promise<string> {
    return paragraphGeneratorPrompt
      .pipe(this.model)
      .pipe(new StringOutputParser())
      .invoke({ input: input.map(({ from, type, to }) => `${from} ${type} ${to};`).join(' ') })
  }
}
