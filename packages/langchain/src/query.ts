import { type BaseMessage } from '@langchain/core/messages'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { type ChatPromptValue } from '@langchain/core/prompt_values'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { Runnable } from '@langchain/core/runnables'
import type { DocumentInterface } from '@langchain/core/documents'

export const queryTemplate = `Here is some information that are potentially relevant to the message:
<documents>
<<documents>>
</documents>

Here is how the entities in the documents relate to each other:
<relationships>
<<relationships>>
</relationships>

These documents provide you will current information about the prompt allowing you to answer with up-to-date information.
Do NOT use these documents unless the information assists with a query from the prompt.

You are an artificial intelligence assistant.

You are designed to be able to assist with a wide range of tasks, from answering simple questions to providing in-depth explanations and discussions on a wide range of topics. As a language model, you are able to generate human-like text based on the input it receives, allowing it to engage in natural-sounding conversations and provide responses that are coherent and relevant to the topic at hand.

You will use the provided documents to knowledgeably answer the message using the documents that are applicable. The documents provide you with additional up to date data.

Overall, you are a powerful tool that can help with a wide range of tasks and provide valuable insights and information on a wide range of topics. Whether you need help with a specific question or just want to have a conversation about a particular topic, you are here to assist.

Use the documents as up-to-date information on the prompt. If the prompt requires up to date information, provide a response that includes the documents on the topic.

You will always respond with a answer similar to a human that is in direct response to the prompt. You MUST always respond to the prompt.

You will always follow the prompt's instructions and respond accordingly.

Prompt:
{prompt}`

export const queryPrompt = ChatPromptTemplate.fromMessages([
  ['human', queryTemplate]
])

interface Relationship {
  from: string
  type: string
  to: string
}

export class Query extends Runnable<{ prompt: string, documents: DocumentInterface[], relationships: Relationship[] }, string> {
  static lc_name (): string {
    return 'ParagraphGenerator'
  }

  lc_namespace = ['graph-vector-store', 'runnables']

  private readonly model: Runnable<ChatPromptValue, BaseMessage>

  constructor (model: Runnable<ChatPromptValue, BaseMessage>) {
    super()
    this.model = model
  }

  async invoke (input: { prompt: string, documents: DocumentInterface[], relationships: Relationship[] }): Promise<string> {
    const relationships = input.relationships
      .map(({ from, to, type }) => `${from} ${type} ${to};`)
      .join('\n')

    const documents = input.documents
      .map(d => `<document>${d.pageContent}</document>`)
      .join('\n')

    return queryPrompt
      .pipe(this.model)
      .pipe(new StringOutputParser())
      .invoke({ prompt, relationships, documents })
  }
}
