#!/usr/bin/env bash

# Prepare the out directory:
mkdir -p $2

function escape () {
  echo $(printf '%s\n' "$1" | sed -e 's/[\/&]/\\&/g')
}

# Convert the template files to config files:
for file in "$1"/*; do
  if [ -f "$file" ]; then
    cp "$file" "$2/$(basename $file)"

    while IFS= read -r line; do
      # Skip empty lines and comments
      [[ $line =~ ^[[:space:]]*$ ]] && continue
      [[ $line =~ ^#.* ]] && continue

      # Extract key-value pairs
      if [[ $line =~ ^(.*?)=(.*)$ ]]; then
        key=${BASH_REMATCH[1]}
        value=${BASH_REMATCH[2]}

        sed -i -e "s/{{[ ]*${key}[ ]*}}/$(escape "${value}")/g" "$2/$(basename $file)"
      fi
    done < "$3"
  fi
done
