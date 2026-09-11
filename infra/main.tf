terraform {
  required_version = ">= 1.5.0"
  required_providers {
    alicloud = {
      source  = "aliyun/alicloud"
      version = "~> 1.292"
    }
  }
}

variable "region" {
  type    = string
  default = "cn-shanghai"
}

variable "bucket_name" {
  description = "Globally unique bucket dedicated to reagent recognition images."
  type        = string
  default     = "bio-reagent-inventory-private-cn-shanghai-20260911-jw"
}

provider "alicloud" {
  region = var.region
}

resource "alicloud_oss_bucket" "recognition" {
  bucket           = var.bucket_name
  storage_class    = "Standard"
  redundancy_type = "LRS"
  force_destroy    = false

  lifecycle_rule {
    id      = "delete-recognition-images-after-one-day"
    enabled = true
    prefix  = "recognition/"

    expiration {
      days = 1
    }

    abort_multipart_upload {
      days = 1
    }
  }

  tags = {
    Project       = "bio-reagent-inventory"
    DataIsolation = "dedicated"
    ManagedBy     = "terraform"
  }

  lifecycle {
    ignore_changes = [acl, server_side_encryption_rule]
  }
}

resource "alicloud_oss_bucket_acl" "recognition" {
  bucket = alicloud_oss_bucket.recognition.bucket
  acl    = "private"
}

resource "alicloud_oss_bucket_server_side_encryption" "recognition" {
  bucket        = alicloud_oss_bucket.recognition.bucket
  sse_algorithm = "AES256"
}

output "recognition_bucket" {
  value = alicloud_oss_bucket.recognition.bucket
}
