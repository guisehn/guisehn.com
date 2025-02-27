---
title: Different approaches for using maps with string keys in Absinthe GraphQL
description: Learning how to accept strings as keys in Absinthe globally, at the object level, or field level.
pubDate: "Feb 28 2025"
---

# The problem

By default, when rendering a GraphQL response, Absinthe only considers atom keys in maps. For example, if your query resolver returns:

```elixir
#       ↓ atom key           ↓ string key
{:ok, %{:name => "John Doe", "age" => 30}}
```

And your GraphQL object definition is:

```elixir
object :person do
  field :name, :string
  field :age, :number
end
```

Absinthe will produce the following GraphQL response:

```json
{
  "data": {
    "person": {
      "name": "John Doe",
      "age": null
    }
  }
}
```

Here, `age` is null because Absinthe expected `:age` (an atom) but only found `"age"` (a string). Meanwhile, name was returned correctly since `:name` is an atom.

While having mixed key types (strings and atoms) in the same map is uncommon, this example highlights the issue.

But why would you have string keys in the first place? This could happen if your data originates from an external API that returns JSON, and you don't want to manually transform it into a struct ([maybe you should consider it](/complex-json-to-struct-elixir-ecto)). You may also want to avoid blindly converting all keys to atoms due to concerns about [atom exhaustion](https://paraxial.io/blog/atom-dos).

# How to allow string keys in Absinthe

This post covers three levels of granularity for enabling string keys in Absinthe: globally, at the object level, and at the field level.

In a large codebase, enabling this behavior globally may be too risky, so applying it at a smaller scope might be preferable.

Regardless of the approach, we first need to define a custom Absinthe middleware.

## Understanding Absinthe's Default Behavior

By default, every field in Absinthe eventually reaches the default middleware, which is [`MapGet`](https://hexdocs.pm/absinthe/Absinthe.Middleware.MapGet.html). Looking at its implementation helps explain why Absinthe only supports atom keys:

```elixir
defmodule Absinthe.Middleware.MapGet do
  @behaviour Absinthe.Middleware

  def call(%{state: :unresolved, source: source} = res, key) do
    %{res | state: :resolved, value: Map.get(source, key)}
  end

  def call(res, _key), do: res
end
```

Notice that it calls `Map.get(source, key)`, and `key` corresponds to the GraphQL field name as an atom (e.g. `:name`, `:age`). This function does not attempt to fetch the key as a string.

## Defining a Custom Middleware

To support both atom and string keys, we can define a middleware that _also_ accepts strings, by copying the existing middleware and doing some small changes.

To make it less likely to break existing code, we can change it to attempt the atom key first, then string later if it doesn't exist, by using [`Map.get/3`](https://hexdocs.pm/elixir/1.18.2/Map.html#get/3) which accepts a fallback.

I'll call it `MyApp.Middleware.MapGetWithIndifferentAccess`, naming inspired by Ruby on Rails's [hash with indifferent access](https://api.rubyonrails.org/v8.0/classes/ActiveSupport/HashWithIndifferentAccess.html), and from now on in this post, use this term whenever we talk about an object that should accept atom or string keys. Feel free to use your own nomenclature.

```elixir
defmodule MyApp.Middleware.MapGetWithIndifferentAccess do
  @behaviour Absinthe.Middleware

  @impl true
  def call(%{state: :unresolved, source: source} = res, key) do
    fallback = Map.get(source, Atom.to_string(key))
    %{res | state: :resolved, value: Map.get(source, key, fallback)}
  end

  def call(res, _key), do: res
end
```

# Applying the custom middleware

Now that we have our middleware `MapGetWithIndifferentAccess`, we can enable it at different levels. I'll start with the broadest solution first (global), then cover at object level and at field level:

## 1. Global level

To enable string keys globally, after having defined our custom middleware `MapGetWithIndifferentAccess`, we go to our schema file and add a [`middleware/3`](https://hexdocs.pm/absinthe/Absinthe.Schema.html#c:middleware/3) callback to set it as the default:

```elixir
def middleware(middleware, field, object) do
  new_middleware = {MyApp.Middleware.MapGetWithIndifferentAccess, field.identifier}

  middleware
  |> Absinthe.Schema.replace_default(new_middleware, field, object)
end
```

If your schema already defines a middleware/3 callback, integrate this logic accordingly. The overall idea is that we need to call [replace_default](https://hexdocs.pm/absinthe/Absinthe.Schema.html#replace_default/4) and pass the custom middleware.

## 2. At object level

Absinthe doesn't support middlewares at the object level, so for object granularity, we still need to add a global middleware on the schema, but somehow detect that only a few specific objects (the ones we allow list) should support string keys.

The first, and simplest approach, is to keep a list of objects on the schema file, and add a clause that only matches for those objects. So, in your schema file, add something like:

```elixir
@objects_with_indifferent_access [:person]

def middleware(middleware, field, object) when object.identifier in @objects_with_indifferent_access do
  new_middleware = {MyApp.Middleware.MapGetWithIndifferentAccess, field.identifier}

  middleware
  |> Absinthe.Schema.replace_default(new_middleware, field, object)
end

def middleware(middleware, _field, _object), do: middleware
```

While this approach works, I don't like that the indication of the objects with indifferent access lives in the schema file, while most of the time the definition of the objects is far away, likely in their own type files. I strongly believe that for better maintainability, related things should be colocated.

To allow things to be colocated, we could store some metadata on the objects indicating that they should allow indifferent access, and read that on the middleware.

Unfortunately, there's no official way of storing metadata about an object in Absinthe, but we can cheat by adding some meta into the `__private__` key. Technically this is for internal use of the framework, but the `object` macro also allows us to put stuff in there:

```elixir
object :person, __private__: [indifferent_access: true] do
  field :name, :string
  field :age, :number
end
```

At the schema, we pattern match against objects with that metadata:

```elixir
def middleware(middleware, field, %{__private__: %{indifferent_access: true}} = object) do
  new_middleware = {MyApp.Middleware.MapGetWithIndifferentAccess, field.identifier}

  middleware
  |> Absinthe.Schema.replace_default(new_middleware, field, object)
end

def middleware(middleware, _field, _object), do: middleware
```

To improve readability, we can also define a custom macro (optional):

```elixir
defmodule MyApp.Schema.Utils do
  defmacro object_with_indifferent_access(name, opts \\ [], do: block) do
    quote do
      object unquote(name), unquote(Keyword.put(opts, :__private__, indifferent_access: true)) do
        unquote(block)
      end
    end
  end
end
```

This allows defining objects more concisely:

```elixir
import MyApp.Schema.Utils

object_with_indifferent_access :person do
  field :name, :string
  field :age, :number
end
```

## 3. At field level

Absinthe allows calling middlewares at the field level, so in order to get string keys to work for fields, you just need to pass our custom middleware `MapGetWithIndifferentAccess` to it:

```elixir
object :person do
  field :name, :string

  field :age, :number do
    middleware MyApp.Middleware.MapGetWithIndifferentAccess, :age
  end
end
```

If you need to add that to multiple fields and it gets too verbose, you could also define a function `indifferent_access/2`. In the example below, I'm adding the function inside the middleware module:

```elixir
defmodule MyApp.Middleware.MapGetWithIndifferentAccess do
  # [existing code]

  def indifferent_access(%Absinthe.Resolution{} = resolution, _opts) do
    key = resolution.definition.schema_node.identifier
    call(resolution, key)
  end
end
```

And use it like this:

```elixir
import MyApp.Middleware.MapGetWithIndifferentAccess, only: [indifferent_access: 2]

object :person do
  field :name, :string

  field :age, :number do
    middleware &indifferent_access/2
  end
end
```

Or you can also go hardcode with a custom macro:

```elixir
defmodule MyApp.Middleware.MapGetWithIndifferentAccess do
  # [existing code]

  defmacro field_with_indifferent_access(name, type, opts \\ [], [do: block] \\ [do: nil]) do
    quote do
      field unquote(name), unquote(type), unquote(opts) do
        middleware MyApp.Middleware.MapGetWithIndifferentAccess, unquote(name)
        if block, do: unquote(block)
      end
    end
  end
end
```

Usage:

```elixir
import MyApp.Middleware.MapGetWithIndifferentAccess, only: :macros

object :person do
  field :name, :string
  field_with_indifferent_access :age, :number
end
```

In this case, I personally think the helper function is already readable enough and I'd avoid defining a macro in this case, ([they can easily get out of hand](https://hexdocs.pm/elixir/macro-anti-patterns.html#unnecessary-macros)).

# Conclusion

This post shares some learnings:

- Absinthe will use the `MapGet` middleware by default, that only supports reading atom keys.
- We can define your own custom middleware to also support string keys.
- The custom middleware can be added either to the schema (global) or to fields, but not at the object level. To support object granularity, we need to use a schema (global) middleware and detect if the object wants indifferent access.
- Macros can help us with to remove code repetition, but they also introduce complexity and indirection. Consider tradeoffs before using.

You can also avoid this altogether by converting your JSON to a struct, and an easy way to do that is via Ecto. I covered that on the post [Converting complex JSON into Elixir structs](/complex-json-to-struct-elixir-ecto)
