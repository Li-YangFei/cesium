/*global define*/
define([
        '../Core/AssociativeArray',
        '../Core/createGuid',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/DeveloperError',
        '../Core/Event',
        '../Core/Iso8601',
        '../Core/JulianDate',
        '../Core/RuntimeError',
        '../Core/TimeInterval',
        './DynamicObject'
    ], function(
        AssociativeArray,
        createGuid,
        defined,
        defineProperties,
        DeveloperError,
        Event,
        Iso8601,
        JulianDate,
        RuntimeError,
        TimeInterval,
        DynamicObject) {
    "use strict";

    function fireChangedEvent(collection) {
        if (collection._suspendCount === 0) {
            var added = collection._addedObjects;
            var removed = collection._removedObjects;
            if (added.length !== 0 || removed.length !== 0) {
                collection._collectionChanged.raiseEvent(collection, added.values, removed.values);
                added.removeAll();
                removed.removeAll();
            }
        }
    }

    /**
     * An observable collection of {@link DynamicObject} instances where each object has a unique id.
     * @alias DynamicObjectCollection
     * @constructor
     */
    var DynamicObjectCollection = function() {
        this._objects = new AssociativeArray();
        this._addedObjects = new AssociativeArray();
        this._removedObjects = new AssociativeArray();
        this._suspendCount = 0;
        this._collectionChanged = new Event();
        this._id = createGuid();
    };

    /**
     * Prevents {@link DynamicObjectCollection#collectionChanged} events from being raised
     * until a corresponding call is made to {@link DynamicObjectCollection#resumeEvents}, at which
     * point a single event will be raised that covers all suspended operations.
     * This allows for many items to be added and removed efficiently.
     * This function can be safely called multiple times as long as there
     * are corresponding calls to {@link DynamicObjectCollection#resumeEvents}.
     */
    DynamicObjectCollection.prototype.suspendEvents = function() {
        this._suspendCount++;
    };

    /**
     * Resumes raising {@link DynamicObjectCollection#collectionChanged} events immediately
     * when an item is added or removed.  Any modifications made while while events were suspended
     * will be triggered as a single event when this function is called.
     * This function is reference counted and can safely be called multiple times as long as there
     * are corresponding calls to {@link DynamicObjectCollection#resumeEvents}.
     *
     * @exception {DeveloperError} resumeEvents can not be called before suspendEvents.
     */
    DynamicObjectCollection.prototype.resumeEvents = function() {
        //>>includeStart('debug', pragmas.debug);
        if (this._suspendCount === 0) {
            throw new DeveloperError('resumeEvents can not be called before suspendEvents.');
        }
        //>>includeEnd('debug');

        this._suspendCount--;
        fireChangedEvent(this);
    };

    /**
     * The signature of the event generated by {@link DynamicObjectCollection#collectionChanged}.
     * @function
     *
     * @param {DynamicObjectCollection} collection The collection that triggered the event.
     * @param {DynamicObject[]} added The array of {@link DynamicObject} instances that have been added to the collection.
     * @param {DynamicObject[]} removed The array of {@link DynamicObject} instances that have been removed from the collection.
     */
    DynamicObjectCollection.collectionChangedEventCallback = undefined;

    defineProperties(DynamicObjectCollection.prototype, {
        /**
         * Gets the event that is fired when objects are added or removed from the collection.
         * The generated event is a {@link DynamicObjectCollection.collectionChangedEventCallback}.
         * @memberof DynamicObjectCollection.prototype
         *
         * @type {Event}
         */
        collectionChanged : {
            get : function() {
                return this._collectionChanged;
            }
        },
        /**
         * Gets a globally unique identifier for this collection.
         * @memberof DynamicObjectCollection.prototype
         *
         * @type {String}
         */
        id : {
            get : function() {
                return this._id;
            }
        }
    });

    /**
     * Computes the maximum availability of the DynamicObjects in the collection.
     * If the collection contains a mix of infinitely available data and non-infinite data,
     * it will return the interval pertaining to the non-infinite data only.  If all
     * data is infinite, an infinite interval will be returned.
     *
     * @returns {TimeInterval} The availability of DynamicObjects in the collection.
     */
    DynamicObjectCollection.prototype.computeAvailability = function() {
        var startTime = Iso8601.MAXIMUM_VALUE;
        var stopTime = Iso8601.MINIMUM_VALUE;
        var dynamicObjects = this._objects.values;
        for ( var i = 0, len = dynamicObjects.length; i < len; i++) {
            var object = dynamicObjects[i];
            var availability = object.availability;
            if (defined(availability)) {
                var start = availability.start;
                var stop = availability.stop;
                if (JulianDate.lessThan(start, startTime) && !start.equals(Iso8601.MINIMUM_VALUE)) {
                    startTime = start;
                }
                if (JulianDate.greaterThan(stop, stopTime) && !stop.equals(Iso8601.MAXIMUM_VALUE)) {
                    stopTime = stop;
                }
            }
        }

        if (Iso8601.MAXIMUM_VALUE.equals(startTime)) {
            startTime = Iso8601.MINIMUM_VALUE;
        }
        if (Iso8601.MINIMUM_VALUE.equals(stopTime)) {
            stopTime = Iso8601.MAXIMUM_VALUE;
        }
        return new TimeInterval({
            start : startTime,
            stop : stopTime
        });
    };

    /**
     * Add an object to the collection.
     *
     * @param {DynamicObject} dynamicObject The object to be added.
     * @exception {DeveloperError} An object with <dynamicObject.id> already exists in this collection.
     */
    DynamicObjectCollection.prototype.add = function(dynamicObject) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(dynamicObject)) {
            throw new DeveloperError('dynamicObject is required.');
        }
        //>>includeEnd('debug');

        var id = dynamicObject.id;
        var objects = this._objects;
        if (defined(objects.get(id))) {
            throw new RuntimeError('An object with id ' + id + ' already exists in this collection.');
        }

        objects.set(id, dynamicObject);

        var removedObjects = this._removedObjects;
        if (!this._removedObjects.remove(id)) {
            this._addedObjects.set(id, dynamicObject);
        }
        fireChangedEvent(this);
    };

    /**
     * Removes an object from the collection.
     *
     * @param {DynamicObject} dynamicObject The object to be added.
     * @returns {Boolean} true if the item was removed, false if it did not exist in the collection.
     */
    DynamicObjectCollection.prototype.remove = function(dynamicObject) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(dynamicObject)) {
            throw new DeveloperError('dynamicObject is required');
        }
        //>>includeEnd('debug');

        return this.removeById(dynamicObject.id);
    };

    /**
     * Removes an object with the provided id from the collection.
     *
     * @param {Object} id The id of the object to remove.
     * @returns {Boolean} true if the item was removed, false if no item with the provided id existed in the collection.
     */
    DynamicObjectCollection.prototype.removeById = function(id) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(id)) {
            throw new DeveloperError('id is required.');
        }
        //>>includeEnd('debug');

        var objects = this._objects;
        var dynamicObject = objects.get(id);
        if (!this._objects.remove(id)) {
            return false;
        }

        if (!this._addedObjects.remove(id)) {
            this._removedObjects.set(id, dynamicObject);
        }
        fireChangedEvent(this);

        return true;
    };

    /**
     * Removes all objects from the collection.
     */
    DynamicObjectCollection.prototype.removeAll = function() {
        //The event should only contain items added before events were suspended
        //and the contents of the collection.
        var objects = this._objects;
        var objectsLength = objects.length;
        var array = objects.values;

        var addedObjects = this._addedObjects;
        var removed = this._removedObjects;

        for (var i = 0; i < objectsLength; i++) {
            var existingItem = array[i];
            var existingItemId = existingItem.id;
            var addedItem = addedObjects.get(existingItemId);
            if (!defined(addedItem)) {
                removed.set(existingItemId, existingItem);
            }
        }

        objects.removeAll();
        addedObjects.removeAll();
        fireChangedEvent(this);
    };

    /**
     * Gets an object with the specified id.
     *
     * @param {Object} id The id of the object to retrieve.
     * @returns {DynamicObject} The object with the provided id or undefined if the id did not exist in the collection.
     */
    DynamicObjectCollection.prototype.getById = function(id) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(id)) {
            throw new DeveloperError('id is required.');
        }
        //>>includeEnd('debug');

        return this._objects.get(id);
    };

    /**
     * Gets the array of DynamicObject instances in the collection.
     * The array should not be modified directly.
     *
     * @returns {DynamicObject[]} the array of DynamicObject instances in the collection.
     */
    DynamicObjectCollection.prototype.getObjects = function() {
        return this._objects.values;
    };

    /**
     * Gets an object with the specified id or creates it and adds it to the collection if it does not exist.
     *
     * @param {Object} id The id of the object to retrieve or create.
     * @returns {DynamicObject} The new or existing object.
     */
    DynamicObjectCollection.prototype.getOrCreateObject = function(id) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(id)) {
            throw new DeveloperError('id is required.');
        }
        //>>includeEnd('debug');

        var dynamicObject = this._objects.get(id);
        if (!defined(dynamicObject)) {
            dynamicObject = new DynamicObject(id);
            this.add(dynamicObject);
        }
        return dynamicObject;
    };

    return DynamicObjectCollection;
});
