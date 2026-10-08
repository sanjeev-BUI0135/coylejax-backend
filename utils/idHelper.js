const { ObjectId } = require('mongodb');

/**
 * Creates a MongoDB query that searches for both _id and id fields
 * with both ObjectId and string variants
 */
const createIdQuery = (searchId) => {
  const queries = [];
     
  // If it's a valid ObjectId, also search _id as ObjectId
  if (ObjectId.isValid(searchId)) {
    queries.push({ _id: new ObjectId(searchId) });
  }

  // Always search by the custom 'id' field as string
  queries.push({ id: searchId });
  
  // Also search _id as string (in case _id is stored as string)
  queries.push({ _id: searchId });
  // console.log(queries);
  return { $or: queries };
};

/**
 * Creates a query for foreign key relationships that handles both formats
 */
const createForeignKeyQuery = (fieldName, searchId) => {
  const queries = {};
  const searchValues = [];
  
  // Add the string version
  searchValues.push(searchId);
  
  // If it's a valid ObjectId, also add ObjectId version
  if (ObjectId.isValid(searchId)) {
    searchValues.push(new ObjectId(searchId));
  }
  
  queries[fieldName] = { $in: searchValues };
  return queries;
};

module.exports = {
  createIdQuery,
  createForeignKeyQuery
};