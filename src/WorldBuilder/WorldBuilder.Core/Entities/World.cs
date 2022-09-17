﻿using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Web;

namespace WorldBuilder.Core.Entities
{
    public class World
    {
        public World()
        {
            Id = Guid.NewGuid();
        }
        public Guid Id { get; set; }
        [Required]
        public Universe Universe { get; set; }
        [Required]
        public Guid UniverseId { get; set; }
        [Required]
        public string Name { get; set; }


    }
}