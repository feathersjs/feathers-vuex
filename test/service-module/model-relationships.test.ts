/*
eslint
@typescript-eslint/explicit-function-return-type: 0,
@typescript-eslint/no-explicit-any: 0
*/
import { assert } from 'chai'
import feathersVuex, { models } from '../../src/index'
import { clearModels } from '../../src/service-module/global-models'

import { feathersRestClient as feathersClient } from '../fixtures/feathers-client'
import Vuex from 'vuex'

describe('Models - `setupInstance` & Relational Data', function() {
  beforeEach(function() {
    clearModels()
  })

  it('initializes instance with return value from setupInstance', function() {
    let calledSetupInstance = false

    const { makeServicePlugin, BaseModel } = feathersVuex(feathersClient, {
      serverAlias: 'myApi'
    })
    class Todo extends BaseModel {
      public id?
      public description: string

      public constructor(data, options?) {
        super(data, options)
      }
    }
    function setupInstance(instance, { models, store }): Todo {
      calledSetupInstance = true

      return Object.assign(instance, {
        extraProp: true
      })
    }
    const store = new Vuex.Store({
      strict: true,
      plugins: [
        makeServicePlugin({
          Model: Todo,
          service: feathersClient.service('service-todos'),
          setupInstance
        })
      ]
    })

    const createdAt = '2018-05-01T04:42:24.136Z'
    const todo = new Todo({
      description: 'Go on a date.',
      isComplete: true,
      createdAt
    })

    assert(calledSetupInstance, 'setupInstance was called')
    assert(todo.extraProp, 'got the extraProp')
  })

  it('allows setting up relationships between models and other constructors', function() {
    const { makeServicePlugin, BaseModel } = feathersVuex(feathersClient, {
      serverAlias: 'myApi'
    })
    class Todo extends BaseModel {
      public id?
      public description: string
      public user: User

      public constructor(data, options?) {
        super(data, options)
      }
    }
    class User extends BaseModel {
      public _id: string
      public firstName: string
      public email: string
    }

    function setupInstance(instance, { models, store }): Todo {
      const { User } = models.myApi

      return Object.assign(instance, {
        // If instance.user exists, convert it to a User instance
        ...(instance.user && { user: new User(instance.user) }),
        // If instance.createdAt exists, convert it to an actual date
        ...(instance.createdAt && { createdAt: new Date(instance.createdAt) })
      })
    }
    const store = new Vuex.Store({
      strict: true,
      plugins: [
        makeServicePlugin({
          Model: Todo,
          service: feathersClient.service('service-todos'),
          setupInstance
        }),
        makeServicePlugin({
          Model: User,
          service: feathersClient.service('users'),
          idField: '_id'
        })
      ]
    })

    const todo = new Todo({
      description: `Show Master Splinter what's up.`,
      isComplete: true,
      createdAt: '2018-05-01T04:42:24.136Z',
      user: {
        _id: 1,
        firstName: 'Michaelangelo',
        email: 'mike@tmnt.com'
      }
    })

    // Check the date
    assert(
      typeof todo.createdAt === 'object',
      'module.createdAt is an instance of object'
    )
    assert(
      todo.createdAt.constructor.name === 'Date',
      'module.createdAt is an instance of date'
    )

    // Check the user
    assert(todo.user instanceof User, 'the user is an instance of User')

    const user = User.getFromStore(1)
    assert.equal(todo.user, user, 'user was added to the user store.')
  })
})

describe('Models - Relationships', function() {
  beforeEach(function() {
    const { makeServicePlugin, BaseModel } = this
    class Task extends BaseModel {
      public static instanceDefaults: {
        id: null
        description: ''
        isComplete: false
      }
    }
    class ServiceTodo extends BaseModel {
      public static instanceDefaults(data) {
        const priority = data.priority || 'normal'
        const defaultsByPriority = {
          normal: {
            description: '',
            isComplete: false,
            task: 'Task',
            item: 'Item',
            priority: ''
          },
          high: {
            isHighPriority: true,
            priority: ''
          }
        }
        return defaultsByPriority[priority]
      }
    }
    class Item extends BaseModel {
      public static instanceDefaults({ Models }) {
        return {
          test: false,
          todo: 'Todo',
          get todos() {
            return Models.Todo.findInStore({ query: {} }).data
          }
        }
      }
    }
    this.store = new Vuex.Store({
      strict: true,
      plugins: [
        makeServicePlugin({
          Model: Task,
          service: feathersClient.service('tasks')
        }),
        makeServicePlugin({
          Model: ServiceTodo,
          service: feathersClient.service('service-todos')
        }),
        makeServicePlugin({
          Model: Item,
          service: feathersClient.service('items'),
          mutations: {
            toggleTestBoolean(state, item) {
              item.test = !item.test
            }
          }
        })
      ]
    })
    this.Todo = ServiceTodo
    this.Task = models.Task
    this.Item = models.Item
  })

  it('can setup relationships through es5 getters in instanceDefaults', function() {
    const { Item, Todo } = this
    const module = new Todo({ id: 5, description: 'hey' })
    const item = new Item({})

    assert(Array.isArray(item.todos), 'Received an array of todos')
    assert(item.todos[0] === module, 'The todo was returned through the getter')
  })

  it('can have different instanceDefaults based on new instance data', function() {
    const { Todo } = this
    const normalTodo = new Todo({
      description: 'Normal'
    })
    const highPriorityTodo = new Todo({
      description: 'High Priority',
      priority: 'high'
    })

    assert(
      !normalTodo.hasOwnProperty('isHighPriority'),
      'Normal todos do not have an isHighPriority default attribute'
    )
    assert(
      highPriorityTodo.isHighPriority,
      'High priority todos have a unique attribute'
    )
  })

  it('converts keys that match Model names into Model instances', function() {
    const { Todo, store } = this
    const module = new Todo({
      task: {
        description: 'test',
        isComplete: true
      }
    })

    assert(
      module.task.constructor.className === 'Task',
      'task is an instance of Task'
    )
    assert.deepEqual(
      store.state.tasks.keyedById,
      {},
      'nothing was added to the store'
    )
  })

  it('adds model instances containing an id to the store', function() {
    const { Todo, store } = this

    const module = new Todo({
      task: {
        id: 1,
        description: 'test',
        isComplete: true
      }
    })

    assert.deepEqual(
      store.state.tasks.keyedById[1],
      module.task,
      'task was added to the store'
    )
  })

  it('works with multiple keys that match Model names', function() {
    const { Todo, store } = this

    const module = new Todo({
      task: {
        id: 1,
        description: 'test',
        isComplete: true
      },
      item: {
        id: 2,
        test: true
      }
    })

    assert.deepEqual(
      store.state.tasks.keyedById[1],
      module.task,
      'task was added to the store'
    )
    assert.deepEqual(
      store.state.items.keyedById[2],
      module.item,
      'item was added to the store'
    )
  })

  it('handles nested relationships', function() {
    const { Todo } = this

    const module = new Todo({
      task: {
        id: 1,
        description: 'test',
        isComplete: true
      },
      item: {
        id: 2,
        test: true,
        todo: {
          description: 'nested todo under item'
        }
      }
    })

    assert(
      module.item.module.constructor.className === 'Todo',
      'the nested todo is an instance of Todo'
    )
  })

  it('handles recursive nested relationships', function() {
    const { Todo, store } = this

    const module = new Todo({
      id: 1,
      description: 'todo description',
      item: {
        id: 2,
        test: true,
        todo: {
          id: 1,
          description: 'todo description'
        }
      }
    })

    assert.deepEqual(
      store.state.todos.keyedById[1],
      module,
      'todo was added to the store'
    )
    assert.deepEqual(
      store.state.items.keyedById[2],
      module.item,
      'item was added to the store'
    )
    assert(module.item, 'todo still has an item')
    assert(module.item.module, 'todo still nested in itself')
  })

  it('updates related data', function() {
    const { Todo, store } = this

    const module = new Todo({
      id: 'todo-1',
      description: 'todo description',
      item: {
        id: 'item-2',
        test: true,
        todo: {
          id: 'todo-1',
          description: 'todo description'
        }
      }
    })

    const storedTodo = store.state.todos.keyedById['todo-1']
    const storedItem = store.state.items.keyedById['item-2']

    store.commit('items/toggleTestBoolean', storedItem)
    // module.item.test = false

    assert.equal(
      module.item.test,
      false,
      'the nested module.item.test should be false'
    )
    assert.equal(
      storedTodo.item.test,
      false,
      'the nested item.test should be false'
    )
    assert.equal(storedItem.test, false, 'item.test should be false')
  })

  it(`allows creating more than once relational instance`, function() {
    const { Todo, store } = this

    const todo1 = new Todo({
      id: 'todo-1',
      description: 'todo description',
      item: {
        id: 'item-2',
        test: true
      }
    })
    const todo2 = new Todo({
      id: 'todo-2',
      description: 'todo description',
      item: {
        id: 'item-3',
        test: true
      }
    })

    const storedTodo = store.state.todos.keyedById['todo-2']
    const storedItem = store.state.items.keyedById['item-3']

    assert.equal(
      todo1.item.test,
      true,
      'the nested module.item.test should be true'
    )
    assert.equal(
      todo2.item.test,
      true,
      'the nested module.item.test should be true'
    )
    assert.equal(
      storedTodo.item.test,
      true,
      'the nested item.test should be true'
    )
    assert.equal(storedItem.test, true, 'item.test should be true')
  })

  it(`handles arrays of related data`, function() {
    const { Todo, store } = this

    const todo1 = new Todo({
      id: 'todo-1',
      description: 'todo description',
      item: [
        {
          id: 'item-1',
          test: true
        },
        {
          id: 'item-2',
          test: true
        }
      ]
    })
    const todo2 = new Todo({
      id: 'todo-2',
      description: 'todo description',
      item: [
        {
          id: 'item-3',
          test: true
        },
        {
          id: 'item-4',
          test: true
        }
      ]
    })

    assert(todo1, 'todo1 is an instance')
    assert(todo2, 'todo2 is an instance')

    const storedTodo1 = store.state.todos.keyedById['todo-1']
    const storedTodo2 = store.state.todos.keyedById['todo-2']
    const storedItem1 = store.state.items.keyedById['item-1']
    const storedItem2 = store.state.items.keyedById['item-2']
    const storedItem3 = store.state.items.keyedById['item-3']
    const storedItem4 = store.state.items.keyedById['item-4']

    assert(storedTodo1, 'should have todo 1')
    assert(storedTodo2, 'should have todo 2')
    assert(storedItem1, 'should have item 1')
    assert(storedItem2, 'should have item 2')
    assert(storedItem3, 'should have item 3')
    assert(storedItem4, 'should have item 4')
  })
})
