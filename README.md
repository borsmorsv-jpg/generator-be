# Landing Generator Backend

A Node.js backend API built with Fastify, Zod, Swagger, Drizzle ORM, and Supabase.

## Features

- ⚡ **Fastify** - Fast and low overhead web framework
- 🔒 **Zod** - TypeScript-first schema validation
- 📚 **Swagger** - Interactive API documentation
- 🗄️ **Drizzle ORM** - TypeScript ORM for SQL databases
- 🚀 **Supabase** - PostgreSQL database with real-time capabilities

## Prerequisites

- Node.js 18+
- PostgreSQL database (via Supabase or local)

## Installation

1. Clone the repository and install dependencies:

```bash
npm install
```

2. Copy the environment file and configure it:

```bash
cp .env.blocks .env
```

3. Update `.env` with your Supabase credentials:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
DATABASE_URL=postgresql://postgres:password@your-project.supabase.co:5432/postgres
```

## Database Setup

1. Generate migrations from your schema:

```bash
npm run db:generate
```

2. Run migrations:

```bash
npm run db:migrate
```

3. (Optional) Open Drizzle Studio to view your database:

```bash
npm run db:studio
```

## Running the Server

### Development Mode (with auto-reload)

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

The server will start on `http://localhost:3000` (or the port specified in your `.env` file).

## API Documentation

Once the server is running, visit:

- **Swagger UI**: http://localhost:3000/docs
- **Health Check**: http://localhost:3000/health

## Project Structure

```
.
├── src/
│   ├── config/          # Configuration files
│   ├── controllers/     # Request handlers
│   ├── db/             # Database connection and schema
│   ├── routes/         # Route definitions
│   ├── schemas/        # Zod validation schemas
│   ├── services/       # Business logic
│   └── server.js       # Main server file
├── drizzle/            # Database migrations (generated)
├── .env.example        # Environment variables template
├── drizzle.config.js   # Drizzle configuration
└── package.json
```

## API Endpoints

### Examples

- `GET /api/v1/examples` - Get all examples
- `GET /api/v1/examples/:id` - Get example by ID
- `POST /api/v1/examples` - Create a new example
- `PUT /api/v1/examples/:id` - Update example by ID
- `DELETE /api/v1/examples/:id` - Delete example by ID

## Example Request

```bash
# Create an blocks
curl -X POST http://localhost:3000/api/v1/examples \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Example",
    "description": "This is an blocks"
  }'

# Get all examples
curl http://localhost:3000/api/v1/examples
```

## Technologies

- [Fastify](https://www.fastify.io/) - Web framework
- [Zod](https://zod.dev/) - Schema validation
- [Drizzle ORM](https://orm.drizzle.team/) - TypeScript ORM
- [Supabase](https://supabase.com/) - Backend platform
- [Swagger](https://swagger.io/) - API documentation

## License

ISC
