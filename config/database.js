const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://host.docker.internal:27017/coyle_jax', {
      //useNewUrlParser: true, - Updates for warning on connection
      //useUnifiedTopology: true, - Updates for warning on connection
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};



module.exports = connectDB;