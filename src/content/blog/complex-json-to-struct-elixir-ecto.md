---
title: Converting complex JSON into Elixir structs
description: Ecto isn't just for database interactions — it can also help convert complex JSON structures into Elixir structs. Here's how.
pubDate: "Feb 10 2025"
---

Converting complex or deeply nested JSON into Elixir structs can be tedious if you write all the conversion logic manually. But did you know Ecto can handle this seamlessly — outside a database context, purely in memory?

For this example, we'll convert the JSON:

```json
{
  "id": 1,
  "name": "Alice Johnson",
  "email": "alice@example.com",
  "profile": {
    "age": 30,
    "location": "New York",
    "preferences": {
      "theme": "dark",
      "notifications": true
    }
  },
  "addresses": [
    {
      "type": "home",
      "street": "123 Main St",
      "city": "New York",
      "state": "NY",
      "zip": "10001"
    },
    {
      "type": "work",
      "street": "456 Business Rd",
      "city": "New York",
      "state": "NY",
      "zip": "10005"
    }
  ]
}
```

so that it becomes a nested struct:

```elixir
%MyApp.User{
  id: 1,
  name: "Alice Johnson",
  email: "alice@example.com",
  profile: %MyApp.User.Profile{
    age: 30,
    location: "New York",
    preferences: %MyApp.User.Profile.Preferences{
      theme: "dark",
      notifications: true
    }
  },
  addresses: [
    %MyApp.User.Address{
      type: "home",
      street: "123 Main St",
      city: "New York",
      state: "NY",
      zip: "10001"
    },
    %MyApp.User.Address{
      type: "work",
      street: "456 Business Rd",
      city: "New York",
      state: "NY",
      zip: "10005"
    }
  ]
}
```

# Ecto embedded schema to the rescue!

`Ecto.Schema` provides `embedded_schema`, `embeds_one`, and `embeds_many`, which allow us to define in-memory schemas.

We can use them to define our structure, and it will automatically create the nested structs:

```elixir
defmodule MyApp.User do
  use Ecto.Schema

  @primary_key false

  embedded_schema do
    field :id, :integer
    field :name, :string
    field :email, :string

    embeds_one :profile, Profile, primary_key: false do
      field :age, :integer
      field :location, :string

      embeds_one :preferences, Preferences, primary_key: false do
        field :theme, :string
        field :notifications, :boolean
      end
    end

    embeds_many :addresses, Address, primary_key: false do
      field :type, :string
      field :street, :string
      field :city, :string
      field :state, :string
      field :zip, :string
    end
  end
end
```

Notice `primary_key: false` on each level: without that, Ecto would automatically add an integer `id` field to each struct.

# Parsing JSON to the Ecto schema

This part is slightly tricky, but we can simplify it with just two small functions!

To instantiate an Ecto schema from an arbitrary JSON/map, Ecto has the functions `cast/3` + `apply_changes/1` in `Ecto.Changeset`. The tricky part is that `cast` requires us to pass the list of keys we want to allow, e.g.:

```elixir
iex(1)> data = %{"id" => 1, "name" => "Alice Johnson", "email" => "alice@example.com", ...}
%{"id" => 1, "name" => "Alice Johnson", ...}

#                                                 ↓ we need to pass all fields here
iex(2)> Ecto.Changeset.cast(%MyApp.User{}, data, [:id, :name])
%MyApp.User{id: 1, name: "Alice Johnson", email: nil}
```

Ecto likely enforces an allowlist of keys because `cast/3` is primarily used in web request contexts, ensuring users can't modify protected database columns. But in our case, we just want to convert the JSON map to the struct allowing all keys. Manually writing them, especially with a nested object structure, would be cumbersome.

Fortunately, Ecto provides [reflection utilities](https://hexdocs.pm/ecto/Ecto.Schema.html#module-reflection), which we can use to auto-generate the keys for allow listing. So let's do it:

```elixir
defmodule MyApp.User do
  # [all the previous code here]

  def from_json(data) do
    %MyApp.User{}
    |> build_changeset(data)
    |> Ecto.Changeset.apply_changes()
  end

  defp build_changeset(schema, data) do
    struct = schema.__struct__

    # Gets the field names, e.g. [:id, :name, :email] so that we can
    # pass them to `cast/3`
    fields = struct.__schema__(:fields) - struct.__schema__(:embeds)

    schema
    |> Ecto.Changeset.cast(data, fields)
    |> then(fn schema ->
      # Now we get the nested structures, e.g. `[:profile, :addresses]`
      embeds = struct.__schema__(:embeds)

      Enum.reduce(embeds, schema, fn embed_name, schema ->
        # We call `build_changeset/2` recursively, so that this also runs
        # for the nested structures like `profile`, `addresses`, `preferences`, etc.
        Changeset.cast_embed(schema, embed_name, with: &build_changeset/2)
      end)
    end)
  end
end
```

And that's it! Now, we can call:

```elixir
MyApp.User.from_json(%{"id" => 1, "name" => "Alice Johnson", ...})
```

and it will automatically parse the nested structure, even taking care of enforcing and converting types where needed.
