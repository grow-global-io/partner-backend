# ECS Cluster
resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster-${var.environment}"
  
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  
  tags = {
    Name        = "${var.project_name}-cluster-${var.environment}"
    Environment = var.environment
  }
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.project_name}-${var.environment}"
  retention_in_days = 30
  
  tags = {
    Name        = "${var.project_name}-log-group-${var.environment}"
    Environment = var.environment
  }
}

# Task Definition
resource "aws_ecs_task_definition" "app" {
  family                   = "${var.project_name}-task-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn
  
  container_definitions = jsonencode([
    {
      name         = "${var.project_name}-container-${var.environment}"
      image        = "${var.ecr_repository_url}:latest"
      essential    = true
      portMappings = [
        {
          containerPort = var.container_port
          hostPort      = var.container_port
          protocol      = "tcp"
        }
      ]
      
      environment = [
        {
          name  = "NODE_ENV"
          value = var.node_env
        },
        {
          name  = "PORT"
          value = tostring(var.container_port)
        }
      ]
      
      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/${var.environment}/mongodb-uri"
        },
        {
          name      = "OPENAI_API_KEY"
          valueFrom = "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/${var.environment}/openai-api-key"
        },
        {
          name      = "TELEGRAM_BOT_TOKEN"
          valueFrom = "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/${var.environment}/telegram-token"
        },
        {
          name      = "JWT_SECRET"
          valueFrom = "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/${var.environment}/jwt-secret"
        }
      ]
      
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
  
  tags = {
    Name        = "${var.project_name}-task-definition-${var.environment}"
    Environment = var.environment
  }
}

# Store secrets in AWS Systems Manager Parameter Store
resource "aws_ssm_parameter" "openai_api_key" {
  name        = "/${var.project_name}/${var.environment}/openai-api-key"
  description = "OpenAI API Key"
  type        = "SecureString"
  value       = var.openai_api_key
  
  tags = {
    Environment = var.environment
  }
}

resource "aws_ssm_parameter" "telegram_token" {
  name        = "/${var.project_name}/${var.environment}/telegram-token"
  description = "Telegram Bot Token"
  type        = "SecureString"
  value       = var.telegram_token
  
  tags = {
    Environment = var.environment
  }
}

resource "aws_ssm_parameter" "jwt_secret" {
  name        = "/${var.project_name}/${var.environment}/jwt-secret"
  description = "JWT Secret Key"
  type        = "SecureString"
  value       = var.jwt_secret
  
  tags = {
    Environment = var.environment
  }
}

# Application Load Balancer
resource "aws_lb" "main" {
  name               = "${var.project_name}-alb-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_security_group]
  subnets            = var.public_subnets
  
  enable_deletion_protection = true
  
  tags = {
    Name        = "${var.project_name}-alb-${var.environment}"
    Environment = var.environment
  }
}

# ALB Target Group
resource "aws_lb_target_group" "app" {
  name        = "${var.project_name}-tg-${var.environment}"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"
  
  health_check {
    healthy_threshold   = 3
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = "/"
    protocol            = "HTTP"
    matcher             = "200-299"
  }
  
  tags = {
    Name        = "${var.project_name}-tg-${var.environment}"
    Environment = var.environment
  }
}

# ALB Listener
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
  
  tags = {
    Name        = "${var.project_name}-http-listener-${var.environment}"
    Environment = var.environment
  }
}

# ECS Service
resource "aws_ecs_service" "app" {
  name                               = "${var.project_name}-service-${var.environment}"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.app.arn
  desired_count                      = var.app_count
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  launch_type                        = "FARGATE"
  scheduling_strategy                = "REPLICA"
  
  network_configuration {
    security_groups  = [var.ecs_tasks_security_group]
    subnets          = var.private_subnets
    assign_public_ip = false
  }
  
  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "${var.project_name}-container-${var.environment}"
    container_port   = var.container_port
  }
  
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
  
  tags = {
    Name        = "${var.project_name}-service-${var.environment}"
    Environment = var.environment
  }
  
  depends_on = [aws_lb_listener.http]
}

# IAM Roles for ECS
data "aws_caller_identity" "current" {}

# ECS Task Execution Role
resource "aws_iam_role" "ecs_execution" {
  name = "${var.project_name}-ecs-execution-role-${var.environment}"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
  
  tags = {
    Name        = "${var.project_name}-ecs-execution-role-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Policy to access Parameter Store secrets
resource "aws_iam_policy" "parameter_store_access" {
  name        = "${var.project_name}-parameter-store-access-${var.environment}"
  description = "Policy to allow access to Parameter Store"
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "ssm:GetParameters",
          "ssm:GetParameter"
        ]
        Effect = "Allow"
        Resource = [
          "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/${var.environment}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "parameter_store_access" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = aws_iam_policy.parameter_store_access.arn
}

# ECS Task Role
resource "aws_iam_role" "ecs_task" {
  name = "${var.project_name}-ecs-task-role-${var.environment}"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
  
  tags = {
    Name        = "${var.project_name}-ecs-task-role-${var.environment}"
    Environment = var.environment
  }
}

# S3 Access Policy for Task Role
resource "aws_iam_policy" "s3_access" {
  name        = "${var.project_name}-s3-access-${var.environment}"
  description = "Policy to allow S3 access for file uploads"
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Effect = "Allow"
        Resource = [
          "arn:aws:s3:::${var.aws_s3_bucket}",
          "arn:aws:s3:::${var.aws_s3_bucket}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "s3_access" {
  role       = aws_iam_role.ecs_task.name
  policy_arn = aws_iam_policy.s3_access.arn
}
