# Graph Vector Store

Improved RAG using Graph databases and vector stores.

## Preface

To make AI work better, access to up-to-date information from diverse sources, including private ones currently absent from training data, is essential. Until long context windows can be properly handled, techniques like Retrieval-Augmented Generation (RAG) are necessary. Unfortunately, vector stores, advertised as a magic solution, have fallen short of expectations in practice. Therefore, significantly improving basic RAG methods is crucial to make them useful.

## Vector Stores

Vector stores work of embeddings which are supposed to capture the semantic essence of the prompt, this is quite error prone and fails very poorly in Q/A senarios. The embedding of a question is often far different that the embedding of text containing the answer, for example compare the following texts:

- (Query) What is X?
- (Embedding #1) What is Y?
- (Embedding #2) X is equal to Z.
- (Embedding #3) X is similar to W.

The first embedding holds closer semantic simularity* to the query than the others despite the second one holding the information needed to answer the query and the third holding relevant information.

Why does this happen when the query is for 'X' and the first embedding has no reference to 'X'? This happens because it's not only the subject of the question that is embedded but the whole question, I tend to think of this simularity search as a text search for something that "sounds like" the query. (Note that I do not mean phonetically sounds like but structually sounding similar.)

To perform better queries, one trick we can perform is to refrase the question as a partial answer make the question "sound like" the result we are actually after:

- (Query) X is a

Now we get embedding #2 or #3 depending on the model.

\* Tested on Nomic Embed V1.5, MXBAI Embed Large V1 335M and Snowflake Arctic Embed 335M
