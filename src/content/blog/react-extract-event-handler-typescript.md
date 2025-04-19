---
title: Extracting event handlers to a function in React while keeping correct types
description: How to preserve correct TypeScript types when extracting event handlers from JSX elements in React.
pubDate: "Apr 17 2025"
---

When an event handler in React starts getting large, it's natural to extract it into its own function.
But when we do that, we lose the benefit of automatic type inference.

Before:

```tsx
import { Button } from "@/components/ui/button";

function MyComponent() {
  return (
    <Button
      onClick={(event) => {
        // `event` is a `React.MouseEvent<HTMLAnchorElement, MouseEvent>` here.
        event.preventDefault();
        doSomething();
      }}
    >
      Hello
    </Button>
  );
}
```

After:

```tsx
import { Button } from "@/components/ui/button";

function MyComponent() {
  const handleClick = (event) => {
    // `event` is of type `any` :(
    event.preventDefault();
    doSomething();
  };

  return <Button onClick={handleClick}>Hello</Button>;
}
```

You can still get the correct type by hovering over the inline function and copying it:

```tsx
import { Button } from "@/components/ui/button";

function MyComponent() {
  const handleClick = (
    event: React.MouseEvent<HTMLAnchorElement, MouseEvent>
  ) => {
    event.preventDefault();
    doSomething();
  };

  return <Button onClick={handleClick}>Hello</Button>;
}
```

But that's tedious and error prone, especially if:

- Your handler accepts multiple arguments;
- The component's types aren't directly exposed for import;
- Or the component evolves, changing its expected types.

It also doesn't help with enforcing return types, which can lead to subtle bugs.

## A better way

Let TypeScript infer the correct types using `React.ComponentProps<T>`:

```tsx
import { Button } from "@/components/ui/button";

function MyComponent() {
  const handleClick: React.ComponentProps<typeof Button>["onClick"] = (
    event
  ) => {
    // event is correctly inferred as `React.MouseEvent<HTMLAnchorElement, MouseEvent>`
    event.preventDefault();
    doSomething();
  };

  return <Button onClick={handleClick}>Hello</Button>;
}
```

Still, that's a bit verbose. Wouldn'it be nice to write this instead?

```tsx
const handleClick: Props<typeof Button, "onClick"> = ...
```

You can, with an utility type:

```tsx
type Prop<
  Component extends ComponentType,
  PropKey extends keyof React.ComponentProps<Component>
> = React.ComponentProps<Component>[PropKey];

type ComponentType = any extends React.ComponentProps<infer R> ? R : never;
```

## Final code

```tsx
import { type Prop } from "@/type-utils";
import { Button } from "@/components/ui/button";

function MyComponent() {
  const handleClick: Prop<typeof Button, "onClick"> = (event) => {
    // event is inferred: `React.MouseEvent<HTMLAnchorElement, MouseEvent>`
    event.preventDefault();
    doSomething();
  };

  return <Button onClick={handleClick}>Hello</Button>;
}
```

This will also automatically infer the expected return value, and multiple arguments if it's the case.
