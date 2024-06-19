FROM chromadb/chroma

RUN apt-get -y update
RUN apt-get -y install curl
