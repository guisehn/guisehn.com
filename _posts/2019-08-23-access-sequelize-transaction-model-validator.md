---
layout: post
title: Accessing Sequelize transaction in model validator
---

There are some cases where you might want to implement a validation method for your Sequelize model that queries other rows in your database to check business rules.

See the example below:

```js
Purchase.init({
  // [...]
}, {
  associate (models) {
    Purchase.belongsTo(models.Customer)
    Purchase.belongsTo(models.Product)
  }, 

  validate: {
    async alcoholicBeveragePermission () {
      const customer = await this.getCustomer()
      const product = await this.getProduct()
      if (product.isAlcoholic && customer.age <= 21) {
        throw new Error('Customer cannot purchase alcoholic beverage.')
      }
    }
  }
})
```

In the example above, we're not passing any transaction option to the `getCustomer` and `getProduct` method calls. If we save a `Purchase` instance using a [transaction](https://sequelize.org/master/manual/transactions.html), these validation queries will end up running outside of your transaction connection and will most likely cause [isolation issues](https://en.wikipedia.org/wiki/Isolation_(database_systems)).

Take this example, where first we create the customer and then make a purchase inside a transaction:

```js
await sequelize.transaction(async transaction => {
  const customer = await Customer.create({ age: 27 }, { transaction })
  const purchase = await customer.createPurchase({ productId: 9 }, { transaction })
})
```

<div class="terminal">
  <pre>Executing (<span style="color:#1f0">1988c02b-2fdb-4a36-afc2-e7e01895e691</span>):
START TRANSACTION;
Executing (<span style="color:#1f0">1988c02b-2fdb-4a36-afc2-e7e01895e691</span>):
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
Executing (<span style="color:#1f0">1988c02b-2fdb-4a36-afc2-e7e01895e691</span>):
INSERT INTO "Customers" ("id","age","createdAt","updatedAt") VALUES (DEFAULT,27,'2019-08-23 22:10:39.813 +00:00','2019-08-23 22:10:39.813 +00:00') RETURNING *;
Executing (<span style="color:#0ff">default</span>):
SELECT "id", "age", "createdAt", "updatedAt" FROM "customers" WHERE id = 2;
Executing (<span style="color:#0ff">default</span>):
SELECT "id", "isAlcoholic", "createdAt", "updatedAt" FROM "products" WHERE id = 9;
Executing (<span style="color:#1f0">1988c02b-2fdb-4a36-afc2-e7e01895e691</span>):
ROLLBACK;
<span style="color:#f00">(node:29502) UnhandledPromiseRejectionWarning: SequelizeValidationError: Validation error: Cannot read property 'age' of null</span>
</pre>
</div>

As you can see, both the product and customer queries of the validation are running outside the transaction, and because the transaction hasn't been commited yet, it hasn't been able to find the customer inside the validator, triggering a TypeError when trying to access the `age` property.

But how to pass the transaction to your queries in a case like that?

Sequelize doesn't provide any way out of the box to access the current transaction inside a model validation function, as we don't have access to the `options` object used on the `create` call used to trigger the validation. The project maintainers are aware of that for at least three years (see issues [4714](https://github.com/sequelize/sequelize/issues/4714#issuecomment-151256536) and [4745](https://github.com/sequelize/sequelize/issues/4745#issuecomment-151758841)) but this doesn't seem to have been added to the project roadmap so far. I find it odd, because this is a very common use case for validation functions.

One option suggested by @janmeier on the first GitHub issue is to make the validation inside the `beforeValidate` [hook](https://sequelize.org/master/manual/hooks.html), which has access to both the model instance and the `options` object including the `transaction`. I don't think validations should belong in there for two reasons, the first one being code cleaness: validations should belong in validators, not in other parts of the model definition. Adding validation logic to the hooks is not obvious and requires the developer to look in one more place to find out about business logic. The second reason is that throwing errors behaves differently from validators: throwing an `Error` from a validator causes Sequelize to throw a `SequelizeValidationError`, while doing that from a hook will just throw a regular `Error` that other portions of your code may be handling differently.

Fortunately though, there's another way to work around it. As we discovered, we have access to both the model instance and the `options` object including the `transaction` on the `beforeValidate` hook. What if we injected the `transaction` property of the `options` into our model instance on this hook, used it in our validator function, and then cleaned it up afterwards on the `afterValidate` hook? This way we can keep our validation logic where it should belong. We can even use [global hooks](https://sequelize.org/master/manual/hooks.html#global---universal-hooks) to make that work on every model.

So let's try that. In our sequelize instantiation, we can set up our two global hooks:

```js
const sequelize = new Sequelize(databaseUrl, {
  // [...]

  // Sequelize doesn't allow us to access the save options
  // (which includes the current transaction) in the model validators.
  // Here, we add a `_validationTransaction` property to the instance so
  // we can access the transaction from the validators.
  hooks: {
    beforeValidate (instance, options) {
      if (options.transaction) {
        instance._validationTransaction = options.transaction
      }
    },
    afterValidate (instance, options) {
      delete instance._validationTransaction
    }
  }
})
```

I decided to use `_validationTransaction` to avoid collisions with native Sequelize properties, but you can choose any other name you want.

After setting up the hooks, you can access the current transaction inside your validators.

```js
Purchase.init({
  // [...]
}, {
  // [...]
  validate: {
    async alcoholicBeveragePermission () {
      const customer = await this.getCustomer({
        transaction: this._validationTransaction
      })
      const product = await this.getProduct({
        transaction: this._validationTransaction
      })
      if (product.isAlcoholic && customer.age <= 21) {
        throw new Error('Customer cannot purchase alcoholic beverage.')
      }
    }
  }
}
```

And by doing that, our previous example now runs all queries inside the same transaction.

<div class="terminal">
  <pre>Executing (<span style="color:#1f0">1988c02b-2fdb-4a36-afc2-e7e01895e691</span>):
START TRANSACTION;
Executing (<span style="color:#1f0">1988c02b-2fdb-4a36-afc2-e7e01895e691</span>):
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
Executing (<span style="color:#1f0">1988c02b-2fdb-4a36-afc2-e7e01895e691</span>):
INSERT INTO "Customers" ("id","age","createdAt","updatedAt") VALUES (DEFAULT,27,'2019-08-23 22:25:32.728 +00:00','2019-08-23 22:25:32.728 +00:00') RETURNING *;
Executing (<span style="color:#1f0">1988c02b-2fdb-4a36-afc2-e7e01895e691</span>):
SELECT "id", "age", "createdAt", "updatedAt" FROM "customers" WHERE id = 2;
Executing (<span style="color:#1f0">1988c02b-2fdb-4a36-afc2-e7e01895e691</span>):
SELECT "id", "isAlcoholic", "createdAt", "updatedAt" FROM "products" WHERE id = 9;
Executing (<span style="color:#1f0">1988c02b-2fdb-4a36-afc2-e7e01895e691</span>):
INSERT INTO "Purchases" ("id","customerId","productId","createdAt","updatedAt") VALUES (DEFAULT,2,9,'2019-08-23 22:25:32.801 +00:00','2019-08-23 22:25:32.801 +00:00') RETURNING *;
Executing (<span style="color:#1f0">1988c02b-2fdb-4a36-afc2-e7e01895e691</span>):
COMMIT;
</pre>
</div>

Keep in mind that this only works for model-wide validations though. The `this` keyword of attribute validations doesn't point to the model instance, so you can't access the transaction in there using this method. In case you need to query external models in there, you'll need to transform it to a model-wide validation in order to access the transaction. Not ideal, but also better than moving validation logic to the hooks.